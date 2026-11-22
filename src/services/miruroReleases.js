import axios from 'axios';
import { AniKotoError } from './anikotoApi.js';

const FEED_URL = 'https://miruro.cx/__data.json';
const CACHE_KEY = 'miruro-release-feed-v1';
const TTL = 60000;
const MAX_STALE = 86400000;
/** @typedef {Record<string, unknown>} Row */
/** @param {unknown} value @returns {Row} */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? /** @type {Row} */ (value) : {};
/** @param {unknown} value */
const text = value => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').trim().slice(0, 500) : '';
/** @param {unknown} value */
const count = value => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 100000 ? Number(value) : null;

/** Decode only JSON reference tables; never execute upstream JavaScript or revive custom types.
 * @param {unknown[]} values @returns {Row} */
export function decodeReleaseTable(values) {
  if (!values.length || values.length > 20000) throw new Error('Invalid release reference table');
  const active = new Set();
  const memo = new Map();
  /** @param {unknown} index @param {number} depth @returns {unknown} */
  function read(index, depth = 0) {
    if (index === -1) return undefined;
    if (!Number.isSafeInteger(index) || Number(index) < 0 || Number(index) >= values.length || depth > 60 || active.has(index)) throw new Error('Invalid release reference');
    if (memo.has(index)) return memo.get(index);
    const value = values[Number(index)];
    if (value === null || typeof value !== 'object') return value;
    active.add(index);
    /** @type {unknown[] | Row} */
    const result = Array.isArray(value) ? [] : Object.create(null);
    for (const [key, reference] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Invalid release field');
      result[key] = read(reference, depth + 1);
    }
    active.delete(index);
    memo.set(index, result);
    return result;
  }
  return object(read(0));
}

/** @param {unknown} value @param {'sub'|'dub'} language */
function normalizeRelease(value, language) {
  const row = object(value), ids = object(row.externalIds), title = object(row.title), counts = object(row.episodeCounts);
  const id = Number(Array.isArray(ids.anilist) ? ids.anilist[0] : null);
  const episode = count(row.episode), timestamp = Number(row.airingAt);
  const name = text(title.english || title.romaji);
  if (!Number.isSafeInteger(id) || id < 1 || id > 999999999 || !name || !episode || !Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 7258118400) return null;
  let poster;
  try { const url = new URL(String(row.coverUrl)); if (url.protocol === 'https:' && !url.username && !url.password) poster = url.href; } catch { /* Missing artwork uses the site's dark placeholder. */ }
  const mal = Number(Array.isArray(ids.mal) ? ids.mal[0] : null);
  return {
    id: `al-${id}`, slug: `al-${id}`, anilist_id: id, mal_id: Number.isSafeInteger(mal) && mal > 0 ? mal : null,
    title: name, japaneseTitle: text(title.native), poster, type: text(row.format).replaceAll('_', ' '),
    year: count(row.seasonYear), total: count(row.episodeCount), sub: count(counts.sub) || count(counts.raw), dub: count(counts.dub),
    latestEpisode: episode, releasedAt: new Date(timestamp * 1000).toISOString(), releaseLanguage: language,
  };
}

/** SvelteKit streams deferred release rails as newline-delimited JSON chunks.
 * @param {string} payload @returns {import('./miruroReleases.types.js').ReleaseFeed} */
export function parseMiruroReleases(payload) {
  if (typeof payload !== 'string' || Buffer.byteLength(payload) > 2 * 1024 * 1024) throw new Error('Invalid release payload');
  const lines = payload.trim().split('\n');
  if (lines.length > 20) throw new Error('Invalid release chunks');
  for (const line of lines) {
    const message = object(JSON.parse(line));
    const values = message.type === 'chunk' && Array.isArray(message.data) ? message.data : null;
    if (!values || !Object.hasOwn(object(values[0]), 'raw') || !Object.hasOwn(object(values[0]), 'dub')) continue;
    const rails = decodeReleaseTable(values);
    const normalize = (kind, language) => {
      const rows = object(rails[kind]).latest;
      if (!Array.isArray(rows) || rows.length > 500) throw new Error('Invalid release list');
      const seen = new Set();
      return rows.map(row => normalizeRelease(row, language)).filter(row => {
        if (!row || seen.has(row.id)) return false;
        seen.add(row.id); return true;
      }).sort((a, b) => Date.parse(b.releasedAt) - Date.parse(a.releasedAt));
    };
    const sub = normalize('raw', 'sub'), dub = normalize('dub', 'dub');
    if (!sub.length && !dub.length) throw new Error('Empty release feed');
    return { sub, dub };
  }
  throw new Error('Release feed is missing');
}

/** @param {{request?: typeof axios.get, now?: () => number, getDatabase?: () => import('better-sqlite3').Database}} options */
export function createMiruroReleases({ request = axios.get, now = Date.now, getDatabase } = {}) {
  /** @type {{feed: import('./miruroReleases.types.js').ReleaseFeed, saved: number}|null} */
  let cached = null;
  /** @type {Promise<import('./miruroReleases.types.js').ReleaseFeed>|null} */
  let pending = null;
  let retryAt = 0, loaded = false;
  function store() {
    if (!getDatabase) return null;
    const db = getDatabase();
    db.exec('CREATE TABLE IF NOT EXISTS release_feed_cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, updated INTEGER NOT NULL)');
    return db;
  }
  async function snapshot() {
    if (!loaded) {
      loaded = true;
      const row = store()?.prepare('SELECT payload, updated FROM release_feed_cache WHERE key=?').get(CACHE_KEY);
      if (row && row.updated > now() - MAX_STALE) {
        try { cached = { feed: parseMiruroReleases(row.payload), saved: row.updated }; } catch { /* A malformed saved feed is replaced by a fresh response. */ }
      }
    }
    if (cached && cached.saved + TTL > now()) return cached.feed;
    if (pending) return pending;
    if (retryAt > now()) {
      if (cached && cached.saved + MAX_STALE > now()) return cached.feed;
      throw new AniKotoError('Latest episode source is temporarily unavailable', 503, '60');
    }
    pending = (async () => {
      try {
        const response = await request(FEED_URL, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, timeout: 12000, maxRedirects: 0, maxContentLength: 2 * 1024 * 1024, responseType: 'text' });
        const feed = parseMiruroReleases(response.data);
        const saved = now();
        store()?.prepare('INSERT OR REPLACE INTO release_feed_cache (key,payload,updated) VALUES (?,?,?)').run(CACHE_KEY, response.data, saved);
        cached = { feed, saved };
        retryAt = 0;
        return feed;
      } catch {
        retryAt = now() + TTL;
        if (cached && cached.saved + MAX_STALE > now()) return cached.feed;
        throw new AniKotoError('Latest episode source is temporarily unavailable', 503, '60');
      } finally { pending = null; }
    })();
    return pending;
  }
  /** @param {{page?: string, language?: 'sub'|'dub'}} params */
  async function page({ page = '1', language = 'sub' } = {}) {
    if (!/^[1-9]\d{0,3}$/.test(String(page)) || !['sub', 'dub'].includes(language)) throw new AniKotoError('Invalid release filter', 400);
    const feed = await snapshot(), rows = feed[language], start = (Number(page) - 1) * 21;
    return { data: rows.slice(start, start + 21), totalPages: Math.max(1, Math.ceil(rows.length / 21)) };
  }
  return { page };
}
