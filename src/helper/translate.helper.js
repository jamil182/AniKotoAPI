/*
 * ======= • ======= • ======= • ======= • =======• =======
 * AniKotoAPI — translate.helper.js
 * Repository: https://github.com/Shineii86
 *
 * @description
 *   Machine translation for subtitle tracks. Rewrites only the spoken text of
 *   a WebVTT document, leaving the header, cue identifiers and every timestamp
 *   exactly as they were, so the translated track stays in sync with the video.
 *
 *   The provider is chosen from the environment: DeepL when DEEPL_API_KEY is
 *   set, otherwise MyMemory, which needs no key. Swapping providers is a
 *   config change, not a code change.
 *
 * @exports
 *   translateVtt, splitVtt, PROVIDER
 *
 * @author  Shinei Nouzen
 * @license MIT
 * ======= • ======= • ======= • ======= • =======• =======
 */

import axios from "axios";

// ══════════════════════════════════════════════════════════════
// PROVIDER SELECTION
// ══════════════════════════════════════════════════════════════

const DEEPL_KEY = process.env.DEEPL_API_KEY || "";
// MyMemory raises the anonymous daily allowance substantially when a contact
// address is supplied, so pass one through if the operator configured it.
const MYMEMORY_EMAIL = process.env.MYMEMORY_EMAIL || "";

const PROVIDER = DEEPL_KEY ? "deepl" : "mymemory";

// MyMemory rejects a longer `q`, which is what forces the batching below
// rather than one request for the whole document.
const MYMEMORY_MAX_Q = 480;
// Cues are packed into one request separated by this marker. It is checked on
// the way back: if the provider mangles or drops it, that batch is retried one
// cue at a time instead of silently mis-aligning the subtitles.
const JOINER = " ||| ";
const JOINER_RE = /\s*\|\|\|\s*/;
const CONCURRENCY = 4;

// ══════════════════════════════════════════════════════════════
// WEBVTT TEXT EXTRACTION
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Locate translatable lines ----
/**
 * Splits a VTT document and marks which lines carry spoken text.
 *
 * Everything structural is left alone: the WEBVTT header, blank separators,
 * timestamp lines, the cue identifier that precedes a timestamp, and NOTE /
 * STYLE / REGION blocks.
 *
 * @param {string} vtt
 * @returns {{ lines: string[], translatable: number[] }} the line array plus
 *   the indices that should be translated
 */
function splitVtt(vtt) {
  const lines = vtt.split(/\r?\n/);
  const translatable = [];

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;                                   // separator
    if (t.includes("-->")) continue;                    // timestamps
    if (i === 0 && /^WEBVTT/i.test(t)) continue;        // header
    if (/^(NOTE|STYLE|REGION)\b/i.test(t)) continue;    // metadata blocks
    if ((lines[i + 1] || "").includes("-->")) continue; // cue identifier
    translatable.push(i);
  }
  return { lines, translatable };
}

// ══════════════════════════════════════════════════════════════
// PROVIDERS
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: MyMemory request ----
/**
 * Translates one string via MyMemory.
 *
 * @param {string} text
 * @param {string} target - e.g. "id"
 * @param {string} source - e.g. "en"
 * @returns {Promise<string>} the translated text
 * @throws {Error} when the service reports a non-200 responseStatus — quota
 *   exhaustion arrives that way, with the reason in responseDetails
 */
async function mymemory(text, target, source) {
  const params = { q: text, langpair: source + "|" + target };
  if (MYMEMORY_EMAIL) params.de = MYMEMORY_EMAIL;

  const res = await axios.get("https://api.mymemory.translated.net/get", {
    params,
    timeout: 20000,
    validateStatus: () => true,
  });

  const data = res.data || {};
  const status = Number(data.responseStatus);
  if (res.status !== 200 || (status && status !== 200)) {
    throw new Error("MyMemory: " + (data.responseDetails || res.status));
  }
  const out = data.responseData && data.responseData.translatedText;
  if (!out) throw new Error("MyMemory returned no text");
  return String(out);
}

// ---- FEATURE: DeepL request ----
/**
 * Translates a batch of strings via DeepL, which accepts repeated `text`
 * parameters and returns them in the same order.
 *
 * @param {string[]} texts
 * @param {string} target
 * @param {string} source
 * @returns {Promise<string[]>}
 */
async function deepl(texts, target, source) {
  const host = DEEPL_KEY.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
  const body = new URLSearchParams();
  texts.forEach((t) => body.append("text", t));
  body.append("target_lang", target.toUpperCase());
  if (source) body.append("source_lang", source.toUpperCase());

  const res = await axios.post("https://" + host + "/v2/translate", body, {
    headers: { Authorization: "DeepL-Auth-Key " + DEEPL_KEY },
    timeout: 20000,
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    throw new Error("DeepL " + res.status + ": " + JSON.stringify(res.data).slice(0, 160));
  }
  return (res.data.translations || []).map((t) => t.text);
}

// ══════════════════════════════════════════════════════════════
// BATCHING
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Pack strings into provider-sized batches ----
/**
 * Groups strings so each joined batch stays under the provider limit. A single
 * string longer than the limit is given a batch of its own.
 *
 * @param {string[]} texts
 * @returns {string[][]}
 */
function batch(texts) {
  const out = [];
  if (PROVIDER === "deepl") {
    for (let i = 0; i < texts.length; i += 40) out.push(texts.slice(i, i + 40));
    return out;
  }
  let cur = [];
  let len = 0;
  for (const t of texts) {
    const add = t.length + JOINER.length;
    if (cur.length && len + add > MYMEMORY_MAX_Q) { out.push(cur); cur = []; len = 0; }
    cur.push(t);
    len += add;
  }
  if (cur.length) out.push(cur);
  return out;
}

// ---- FEATURE: Translate one batch, with a per-item fallback ----
/**
 * Translates a batch and returns results aligned to the input.
 *
 * A batched reply is only trusted when the provider hands back exactly as many
 * segments as it was given. Anything else would shift cues against their
 * timestamps, so the batch is redone one item at a time.
 *
 * @param {string[]} items
 * @param {string} target
 * @param {string} source
 * @returns {Promise<string[]>} same length as items
 */
async function translateBatch(items, target, source) {
  if (PROVIDER === "deepl") {
    const out = await deepl(items, target, source);
    return out.length === items.length ? out : items;
  }

  if (items.length === 1) return [await mymemory(items[0], target, source)];

  try {
    const joined = await mymemory(items.join(JOINER), target, source);
    const parts = joined.split(JOINER_RE);
    if (parts.length === items.length) return parts.map((p) => p.trim());
  } catch { /* fall through to the per-item path */ }

  const one = [];
  for (const it of items) {
    try { one.push(await mymemory(it, target, source)); }
    catch { one.push(it); }                       // keep the original on failure
  }
  return one;
}

// ══════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Translate a whole VTT document ----
/**
 * Produces a translated copy of a WebVTT document.
 *
 * Identical lines are translated once and reused, which removes a large slice
 * of the request count on dialogue-heavy episodes.
 *
 * @param {string} vtt - the source WebVTT
 * @param {string} target - target language code, e.g. "id"
 * @param {object} [opts]
 * @param {string} [opts.source="en"] - source language code
 * @returns {Promise<{vtt: string, provider: string, translated: number}>}
 *
 * @example
 *   const { vtt } = await translateVtt(source, "id");
 */
async function translateVtt(vtt, target, opts = {}) {
  const source = opts.source || "en";
  const { lines, translatable } = splitVtt(vtt);

  const unique = [...new Set(translatable.map((i) => lines[i]))];
  const map = new Map();
  const batches = batch(unique);

  // Small worker pool: these providers throttle aggressively, and firing a
  // whole episode at once earns a 429 rather than a faster result.
  let cursor = 0;
  const worker = async () => {
    while (cursor < batches.length) {
      const items = batches[cursor++];
      const out = await translateBatch(items, target, source);
      items.forEach((it, k) => map.set(it, out[k] ?? it));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker)
  );

  for (const i of translatable) lines[i] = map.get(lines[i]) ?? lines[i];

  return { vtt: lines.join("\n"), provider: PROVIDER, translated: unique.length };
}

export { translateVtt, splitVtt, PROVIDER };

// ══════════════════════════════════════════════════════════════ END: translate.helper.js
