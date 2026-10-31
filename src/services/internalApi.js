import { randomBytes, timingSafeEqual } from 'node:crypto';

const token = randomBytes(32).toString('hex');
const header = 'x-anijs-internal-api';

/** Only the configured native API on this site's origin receives the marker.
 * The process-local marker is never persisted or returned to browsers.
 * @param {URL} base
 * @param {string | undefined} siteUrl
 * @returns {Record<string, string>}
 */
export function internalApiHeaders(base, siteUrl = process.env.SITE_URL) {
  try {
    const site = new URL(siteUrl || '');
    return site.protocol === 'https:' && base.origin === site.origin && base.pathname === '/api/'
      ? { [header]: token } : {};
  } catch { return {}; }
}

/** @param {import('express').Request} req */
export function isInternalApiRequest(req) {
  const value = req.get(header);
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(token));
}
