import axios from "axios";
import { internalApiHeaders } from './internalApi.js';

export class AniKotoError extends Error {
  constructor(message, status = 502, retryAfter = null) {
    super(message);
    this.name = "AniKotoError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** @param {unknown} value */
export function normalizeAnime(value) {
  if (!isRecord(value)) return null;
  const slug = typeof value.slug === "string" ? value.slug.split("/")[0] : "";
  if (!/^[a-z0-9][a-z0-9_-]{0,239}$/i.test(slug)) return null;
  return {
    ...value,
    id: slug,
    slug,
    title: String(value.title || value.name || "Untitled"),
    japanese_title: String(value.japaneseTitle || ""),
    genres: Array.isArray(value.genres) ? value.genres.filter(g => typeof g === "string") : [],
  };
}

/** @param {unknown} value */
export function normalizeList(value) {
  const rows = Array.isArray(value) ? value : (isRecord(value) && Array.isArray(value.data) ? value.data : []);
  const seen = new Set();
  return rows.map(normalizeAnime).filter(item => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/**
 * Shared short cache and in-flight deduplication keep polling affordable.
 * The base URL is operator configuration; request parameters never choose a host.
 * @param {{baseUrl?: string, ttlMs?: number, maxEntries?: number, request?: typeof axios.get, now?: () => number}} options
 */
export function createAniKotoClient({
  baseUrl = process.env.ANIKOTO_API_BASE_URL || "https://anikototvapi.vercel.app/api",
  ttlMs = 30000,
  maxEntries = 200,
  request = axios.get,
  now = Date.now,
} = {}) {
  const base = new URL(baseUrl.replace(/\/+$/, "") + "/");
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw new Error("ANIKOTO_API_BASE_URL must be an HTTPS API URL without credentials, query or fragment");
  }
  const cache = new Map();
  const pending = new Map();

  async function get(endpoint, params = {}) {
    if (!/^(?:\/|\/(?:top-ten|most-popular|newly-added|search|info|schedule|random|watch|servers|stream|stream\/resolve|filter|latest-updated|trending)|\/(?:episodes|genre|az-list)\/[a-z0-9_-]+|\/type\/(?:tv|movie|ova|ona|special)|\/status\/(?:upcoming|ongoing|completed))$/i.test(endpoint)) {
      throw new AniKotoError("Unsupported AniKoto endpoint", 400);
    }
    const query = new URLSearchParams(params);
    query.sort();
    const url = new URL(endpoint.slice(1), base);
    url.search = query.toString();
    const key = url.href;
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.value;
    if (pending.has(key)) return pending.get(key);
    const operation = (async () => {
      try {
        const { data } = await request(url.href, {
          timeout: 12000, maxRedirects: 0, maxContentLength: 4 * 1024 * 1024,
          headers: { Accept: "application/json", ...internalApiHeaders(base) },
        });
        if (!isRecord(data) || data.success !== true || data.results === undefined || data.results === null) {
          throw new AniKotoError("AniKotoAPI returned an invalid or unsuccessful response");
        }
        for (const [cacheKey, entry] of cache) {
          if (entry.expires <= now()) cache.delete(cacheKey);
        }
        if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
        cache.set(key, { value: data.results, expires: now() + ttlMs });
        return data.results;
      } catch (error) {
        if (error instanceof AniKotoError) throw error;
        const status = error?.response?.status;
        if (status === 429) throw new AniKotoError("AniKotoAPI is busy. Please retry shortly.", 429, error.response.headers?.["retry-after"] || "30");
        if (status === 404) throw new AniKotoError("Anime or episode not found", 404);
        if (error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT") throw new AniKotoError("AniKotoAPI request timed out", 504);
        throw new AniKotoError("AniKotoAPI is temporarily unavailable");
      } finally {
        pending.delete(key);
      }
    })();
    pending.set(key, operation);
    return operation;
  }

  /** @returns {Promise<import('./anikotoApi.types.js').CatalogHome>} */
  async function home() {
    const [raw, ranking, popular] = await Promise.all([
      get("/"), get("/top-ten").catch(() => null), get("/most-popular").catch(() => null),
    ]);
    if (!isRecord(raw) || !Array.isArray(raw.trending) || !Array.isArray(raw.spotlights)) {
      throw new AniKotoError("AniKotoAPI returned an invalid home response");
    }
    const top = normalizeList(raw.topAiring);
    const rankings = Object.fromEntries(["today", "week", "month"].map(period => [
      period, ranking && Array.isArray(ranking[period]) ? normalizeList(ranking[period]) : top,
    ]));
    return {
      spotlights: normalizeList(raw.spotlights), latest: normalizeList(raw.trending),
      top: rankings.today, rankings, popular: popular ? normalizeList(popular) : top,
      genres: Array.isArray(raw.genres) ? raw.genres.filter(g => typeof g === "string") : [],
      fetchedAt: new Date(now()).toISOString(),
    };
  }

  return { get, home };
}
