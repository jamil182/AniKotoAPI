import { visitorAddress } from '../services/visitorAddress.js';
import { isInternalApiRequest } from '../services/internalApi.js';

const media = new Set(['/api/stream/proxy', '/api/stream/ts-proxy', '/api/stream/sub-proxy']);
const playback = /^\/api\/catalog\/(?:anime\/[^/]+|episodes\/[^/]+|watch|embeds?|servers|resolve(?:-stored)?|schedule-watch)$/;

/** @param {unknown} value @param {number} fallback @param {number} max */
function positive(value, fallback, max) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= max ? parsed : fallback;
}

/** Isolate playback bursts from browsing; keep native server calls from sharing
 * one public-IP allowance across every visitor. Authentication/write-specific
 * limiters remain in their own routers.
 * @param {{limit?: number | string, playbackLimit?: number | string, windowMs?: number | string, maxBuckets?: number, now?: () => number}} options
 * @returns {import('express').RequestHandler}
 */
export function createApiRateLimit({ limit = process.env.RATE_LIMIT, playbackLimit = process.env.PLAYBACK_RATE_LIMIT,
  windowMs = process.env.RATE_WINDOW, maxBuckets = 10000, now = Date.now } = {}) {
  const generalLimit = positive(limit, 100, 10000);
  const videoLimit = positive(playbackLimit, Math.max(300, generalLimit), 10000);
  const duration = positive(windowMs, 60000, 3600000);
  const capacity = positive(maxBuckets, 10000, 100000);
  /** @type {Map<string, number[]>} */
  const buckets = new Map();
  let cleanupAt = 0;
  return (req, res, next) => {
    const path = req.path.replace(/\/+$/, '') || '/';
    if (path !== '/api' && !path.startsWith('/api/')) return next();
    if (req.method === 'OPTIONS' || (req.method === 'GET' && (media.has(path) || path === '/api/health'))) return next();
    const group = playback.test(path) ? 'playback' : /^\/api\/(?:catalog|auth|comments|admin|visit|visitors)(?:\/|$)/.test(path) ? 'general' : 'native';
    if (group === 'native' && req.method === 'GET' && isInternalApiRequest(req)) return next();
    const time = now();
    if (time >= cleanupAt) {
      for (const [key, times] of buckets) if (times.at(-1) <= time - duration) buckets.delete(key);
      cleanupAt = time + duration;
    }
    const key = `${group}:${visitorAddress(req) || req.ip || req.socket.remoteAddress || 'unknown'}`;
    const times = (buckets.get(key) || []).filter(timestamp => timestamp > time - duration);
    const max = group === 'playback' ? videoLimit : generalLimit;
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Bucket', group);
    if (times.length >= max || (!buckets.has(key) && buckets.size >= capacity)) {
      const retryAfter = times.length ? Math.max(1, Math.ceil((times[0] + duration - time) / 1000)) : 1;
      res.set('X-RateLimit-Remaining', '0');
      res.set('Retry-After', String(retryAfter));
      res.set('Cache-Control', 'no-store');
      return res.status(429).json({ success: false, message: 'Rate limit exceeded. Try again later.', retryAfter });
    }
    times.push(time);
    buckets.set(key, times);
    res.set('X-RateLimit-Remaining', String(max - times.length));
    next();
  };
}
