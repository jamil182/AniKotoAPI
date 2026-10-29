import { Router } from 'express';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** @param {string} publicDirectory */
export function createBrandingRouter(publicDirectory) {
  const router = Router();
  /** @type {Map<string, {fingerprint: string, url: Promise<string>}>} */
  const versions = new Map();
  /** @param {'logo.png' | 'favicon.png'} name */
  async function assetUrl(name) {
    const filename = path.join(publicDirectory, name);
    const info = await stat(filename);
    if (!info.isFile() || info.size === 0 || info.size > 10 * 1024 * 1024) throw new Error('Invalid branding asset');
    const fingerprint = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
    const cached = versions.get(name);
    if (cached?.fingerprint === fingerprint) return cached.url;
    const entry = {
      fingerprint,
      url: readFile(filename).then(bytes => `/${name}?v=${createHash('sha256').update(bytes).digest('hex').slice(0, 24)}`),
    };
    versions.set(name, entry);
    try { return await entry.url; }
    catch (error) {
      if (versions.get(name) === entry) versions.delete(name);
      throw error;
    }
  }
  router.get('/', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('CDN-Cache-Control', 'no-store');
    try {
      const [logo, favicon] = await Promise.all([assetUrl('logo.png'), assetUrl('favicon.png')]);
      res.json({ success: true, results: { logo, favicon } });
    } catch {
      res.status(503).json({ success: false, message: 'Branding images are temporarily unavailable.' });
    }
  });
  return router;
}
