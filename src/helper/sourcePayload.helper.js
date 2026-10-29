import { createDecipheriv } from 'node:crypto';

// Public transport constants used by the provider's shipped browser client.
// They encode source URLs; video content is not decrypted here.
const SOURCE_KEY = Buffer.alloc(32);
SOURCE_KEY.write('i?LMTAx0Q6,:}50U');
const SOURCE_IV = Buffer.from("W0;27ToaUpl_P%'c", 'utf8');

/**
 * Normalize both the original JSON sources and the provider's enc envelope.
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, unknown>}
 */
export function decodeSourcePayload(payload) {
  if (payload.enc === undefined) return payload;
  if (typeof payload.enc !== 'string' || payload.enc.length > 16384 || !/^[\w-]+={0,2}$/.test(payload.enc)) {
    throw new Error('Invalid encrypted source payload');
  }
  try {
    const cipher = createDecipheriv('aes-256-cbc', SOURCE_KEY, SOURCE_IV);
    const text = Buffer.concat([cipher.update(Buffer.from(payload.enc, 'base64url')), cipher.final()]).toString('utf8');
    const decoded = JSON.parse(text);
    if (!decoded || typeof decoded.file !== 'string') throw new Error('Missing video URL');
    const url = new URL(decoded.file);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid video URL');
    return { ...payload, sources: { file: url.href } };
  } catch {
    throw new Error('Could not decode provider video sources');
  }
}
