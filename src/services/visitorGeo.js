import { isPublicIp } from './visitorAddress.js';

/** @typedef {import('./visitors.types.js').VisitorLocation} VisitorLocation */
const unavailable = Object.freeze({ country: '', region: '', city: '', status: 'unavailable' });
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100) : '';

/** Bounded cache, no queue, and a daily budget keep geolocation off the hot path.
 * @param {{fetchImpl?: typeof fetch, now?: () => number, enabled?: boolean}} options
 */
export function createVisitorGeo({ fetchImpl = fetch, now = Date.now, enabled = true } = {}) {
  const cache = new Map();
  let active = 0, day = '', used = 0, blockedUntil = 0;
  return {
    /** @param {string} ip @returns {Promise<VisitorLocation>} */
    async lookup(ip) {
      if (!isPublicIp(ip)) return { country: '', region: '', city: '', status: 'local' };
      if (!enabled) return { ...unavailable, status: 'disabled' };
      const time = now();
      const cached = cache.get(ip);
      if (cached && cached.expires > time) return cached.promise;
      const today = new Date(time).toISOString().slice(0, 10);
      if (today !== day) { day = today; used = 0; }
      if (active >= 2 || used >= 900 || time < blockedUntil) return unavailable;
      active++; used++;
      const entry = { expires: time + 86_400_000, promise: Promise.resolve(unavailable) };
      entry.promise = (async () => {
        try {
          const response = await fetchImpl(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,region,city`, {
            signal: AbortSignal.timeout(4000), redirect: 'error', headers: { Accept: 'application/json' },
          });
          if (response.status === 429) blockedUntil = time + 86_400_000;
          if (!response.ok) throw new Error('Geolocation unavailable');
          const data = await response.json();
          if (data?.success !== true) throw new Error('Invalid geolocation');
          return { country: clean(data.country), region: clean(data.region), city: clean(data.city), status: 'resolved' };
        } catch {
          entry.expires = time + 300_000;
          return unavailable;
        } finally { active--; }
      })();
      if (cache.size >= 2000) cache.delete(cache.keys().next().value);
      cache.set(ip, entry);
      return entry.promise;
    },
  };
}
