/*
 * ======= • ======= • ======= • ======= • =======• =======
 * MiruroAPI — cache.js
 * Repository: https://github.com/Shineii86/MiruroAPI
 *
 * @description
 *   In-memory caching utility for storing and retrieving API responses.
 *   Implements TTL-based cache invalidation to prevent stale data
 *   while reducing unnecessary requests to AniList/Miruro backends.
 *
 * @exports
 *   getCached, setCache, clearCache
 *
 * @author  Shinei Nouzen
 * @license MIT
 * ======= • ======= • ======= • ======= • =======• =======
 */

// ══════════════════════════════════════════════════════════════
// CACHE STORAGE & CONFIGURATION
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: In-memory Map-based cache storage ----
/**
 * Internal cache storage using JavaScript Map object.
 * Stores data with expiry timestamps for TTL-based expiration.
 *
 * @type {Map<string, {data: any, expiry: number}>}
 */
const cache = new Map();

// ---- FEATURE: Cache time-to-live configuration (1 minute) ----
/**
 * Default cache TTL (Time-To-Live) in milliseconds.
 * Default: 1 minute (60,000 ms).
 * After this duration, cached items are considered stale
 * and will be removed on next access.
 *
 * @type {number}
 * @default 60000
 */
const DEFAULT_TTL = 60 * 1000;

// ---- FEATURE: Maximum cache size limit ----
/**
 * Maximum number of entries allowed in the cache.
 * When exceeded, the oldest entry is evicted (FIFO).
 * Prevents unbounded memory growth on long-running instances.
 *
 * @type {number}
 * @default 100
 */
const MAX_CACHE_SIZE = 100;

// ══════════════════════════════════════════════════════════════
// CACHE OPERATIONS
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Retrieve cached data by key with TTL validation ----
/**
 * Retrieves data from cache if it exists and hasn't expired.
 * Automatically removes stale entries on access (lazy eviction).
 *
 * @param {string} key - The cache key to lookup
 * @returns {any|null} Cached data if valid, null if expired or missing
 *
 * @example
 *   const data = getCached("search:naruto:1:20");
 *   if (data) {
 *     // Use cached data
 *   }
 */
const getCached = (key) => {
  const entry = cache.get(key);
  if (!entry) return null;

  // NOTE: Lazy eviction — delete stale entries on access
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }

  return entry.data;
};

// ---- FEATURE: Store data in cache with TTL expiry ----
/**
 * Stores data in cache with TTL-based expiry.
 * Evicts oldest entry if cache is at max capacity (FIFO).
 *
 * @param {string} key - The cache key to store under
 * @param {any} data - The data to cache (any serializable type)
 * @param {number} [ttl=DEFAULT_TTL] - Time-to-live in milliseconds
 * @returns {void}
 *
 * @example
 *   // Cache search results for 2 minutes
 *   setCache("search:one-piece", results, 120000);
 */
const setCache = (key, data, ttl = DEFAULT_TTL) => {
  // NOTE: FIFO eviction — remove oldest entry when cache is full
  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }

  // NOTE: Periodic cleanup — prune all expired entries when cache reaches 80% capacity
  // Prevents unbounded memory growth from stale entries that were never accessed
  if (cache.size >= MAX_CACHE_SIZE * 0.8) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now > v.expiry) cache.delete(k);
    }
  }

  cache.set(key, { data, expiry: Date.now() + ttl });
};

// ---- FEATURE: Clear all cached entries from memory ----
/**
 * Clears all entries from the cache. Use when:
 * - Memory cleanup is needed
 * - Force-refreshing all data
 * - Application restart/reset
 *
 * @returns {void}
 */
const clearCache = () => {
  cache.clear();
};

// ---- FEATURE: Get current cache size ----
/**
 * Returns the current number of entries in the cache.
 *
 * @returns {number} Current cache size
 */
const getCacheSize = () => cache.size;

module.exports = { getCached, setCache, clearCache, getCacheSize };

// ══════════════════════════════════════════════════════════════ END: cache.js

