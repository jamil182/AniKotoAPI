import { commentMedia, klipyImageUrl } from "./comment-media-data.js?v=2";

/** @type {Promise<import('./comment-media.types.js').MediaConfig> | null} */ let configuration =
  null;
/** @returns {Promise<import('./comment-media.types.js').MediaConfig>} */
export function mediaConfiguration() {
  if (!configuration)
    configuration = (async () => {
      const response = await fetch("/api/comments/media-config", {
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      const body = await response.json();
      const data = body?.results;
      if (
        !response.ok ||
        body?.success !== true ||
        typeof data?.enabled !== "boolean" ||
        data.provider !== "klipy" ||
        typeof data.publicApiKey !== "string" ||
        (data.enabled && !/^[a-z0-9_-]{8,160}$/i.test(data.publicApiKey))
      )
        throw new Error("Media search unavailable.");
      return data;
    })().catch((error) => {
      configuration = null;
      throw error;
    });
  return configuration;
}

/** @param {unknown} raw @param {'gif' | 'image'} kind @returns {import('./comment-media.types.js').MediaItem} */
export function klipyItem(raw, kind) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid media response.");
  const row = /** @type {Record<string, unknown>} */ (raw);
  const media = commentMedia({
    provider: "klipy",
    id: row.id,
    kind,
    slug: row.slug,
    title:
      typeof row.title === "string"
        ? row.title.slice(0, 160)
        : kind === "gif"
          ? "GIF"
          : "Image",
  });
  if (
    !media ||
    !Number.isSafeInteger(media.id) ||
    !(kind === "gif"
      ? row.type === "gif"
      : ["static-meme", "static_meme"].includes(String(row.type))) ||
    !row.file ||
    typeof row.file !== "object"
  )
    throw new Error("Media search unavailable.");
  const files =
    /** @type {Record<string, Record<string, {url?: unknown, width?: unknown, height?: unknown, size?: unknown}>>} */ (
      row.file
    );
  const formats =
    kind === "gif" ? ["webp", "gif"] : ["webp", "png", "jpg", "jpeg"];
  /** @param {string[]} sizes */
  const choose = (sizes) => {
    for (const size of sizes)
      for (const format of formats) {
        const variant = files[size]?.[format];
        const url = klipyImageUrl(variant?.url);
        if (
          url &&
          (!Number.isFinite(Number(variant.size)) ||
            Number(variant.size) <= 4 * 1024 * 1024)
        )
          return {
            url,
            width: Math.min(2048, Math.max(1, Number(variant.width) || 220)),
            height: Math.min(2048, Math.max(1, Number(variant.height) || 220)),
          };
      }
    throw new Error("Media image unavailable.");
  };
  const full = choose(["md", "sm", "hd", "xs"]),
    preview = choose(["xs", "sm", "md", "hd"]);
  return {
    media,
    url: full.url,
    preview: preview.url,
    width: full.width,
    height: full.height,
  };
}

/** @param {'gif' | 'image'} kind @param {string} action @param {URLSearchParams} params @param {AbortSignal} [signal]
 * @returns {Promise<import('./comment-media.types.js').MediaPage>} */
async function request(kind, action, params, signal) {
  const config = await mediaConfiguration();
  if (!config.enabled)
    throw new Error("GIF and image search is not enabled yet.");
  const endpoint = kind === "gif" ? "gifs" : "static-memes";
  const url = new URL(
    `https://api.klipy.com/api/v1/${encodeURIComponent(config.publicApiKey)}/${endpoint}/${action}`,
  );
  url.search = params.toString();
  const response = await fetch(url, {
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "strict-origin-when-cross-origin",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.result !== true)
    throw new Error(
      response.status === 429
        ? "Media search limit reached. Please try again shortly."
        : "Media search unavailable. Please try again.",
    );
  const rows = Array.isArray(body.data?.data)
    ? body.data.data
    : Array.isArray(body.data)
      ? body.data
      : null;
  if (!rows || rows.length > 50) throw new Error("Invalid media response.");
  return {
    items: rows.map((row) => klipyItem(row, kind)),
    page: Number(body.data?.current_page) || 1,
    hasNext: body.data?.has_next === true,
  };
}

/** @param {'gif' | 'image'} kind @param {string} query @param {number} page @param {AbortSignal} signal
 * @returns {Promise<import('./comment-media.types.js').MediaPage>} */
export function searchMedia(kind, query, page, signal) {
  if (
    !["gif", "image"].includes(kind) ||
    typeof query !== "string" ||
    query.length > 80 ||
    /[\x00-\x1f\x7f]/.test(query) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 100
  )
    throw new Error("Invalid media search.");
  const params = new URLSearchParams({
    page: String(page),
    per_page: "24",
    locale: document.documentElement.lang === "id" ? "id" : "us",
    content_filter: "high",
  });
  if (kind === "gif") params.set("format_filter", "gif,webp,jpg");
  if (query) params.set("q", query);
  return request(kind, query ? "search" : "trending", params, signal);
}

/** @param {'gif' | 'image'} kind @param {string[]} slugs
 * @returns {Promise<import('./comment-media.types.js').MediaPage>} */
export function mediaItems(kind, slugs) {
  if (
    !slugs.length ||
    slugs.length > 40 ||
    slugs.some((slug) => !/^[a-z0-9][a-z0-9_-]{0,159}$/i.test(slug))
  )
    throw new Error("Invalid media references.");
  return request(
    kind,
    "items",
    new URLSearchParams({ slugs: slugs.join(",") }),
  );
}
