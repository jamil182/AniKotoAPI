import { Router } from 'express';
import axios from 'axios';
import { createHash } from 'node:crypto';
import { getTranslation, putTranslation } from '../db/translation.repo.js';
import { translateVtt, splitVtt, PROVIDER } from '../helper/translate.helper.js';
import { assertProxyableUrl, streamRefererHeaders } from '../helper/streamProxy.helper.js';

/** @param {string} url */
async function fetchSubtitle(url, signal) {
  const response = await axios.get(url, { headers: streamRefererHeaders(), responseType: 'text',
    timeout: 15_000, maxContentLength: 2 * 1024 * 1024, maxRedirects: 0, signal });
  const text = String(response.data).replace(/^\uFEFF/, '');
  return text.trimStart().startsWith('WEBVTT') ? text : 'WEBVTT\n\n' + text;
}

/** Work runs outside HTTP requests so long episodes do not exceed proxy timeouts.
 * @param {() => import('better-sqlite3').Database} getDatabase
 * @param {{translate?: typeof translateVtt, load?: typeof fetchSubtitle, now?: () => number, provider?: string}} options
 */
export function createSubtitleTranslationRouter(getDatabase, { translate = translateVtt, load = fetchSubtitle, now = Date.now, provider = PROVIDER } = {}) {
  const router = Router(), jobs = new Map();
  let active = 0, quotaUntil = 0;
  router.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { url, to = 'id', from = 'en' } = req.query;
    if (typeof url !== 'string' || url.length > 4096 || typeof to !== 'string' || typeof from !== 'string'
      || !/^[a-z]{2}(?:-[a-z]{2})?$/.test(to) || !/^[a-z]{2}(?:-[a-z]{2})?$/.test(from)) {
      return res.status(400).json({ success: false, message: 'Parameter subtitle tidak valid.' });
    }
    const check = assertProxyableUrl(url);
    if (!check.ok) return res.status(check.status).json({ success: false, message: check.message });
    const sourceKey = JSON.stringify(['v2', from, provider, url]);
    const key = createHash('sha256').update(sourceKey + to).digest('hex');
    const fail = (status, message, retry = 30) => res.status(status).set('Retry-After', String(retry)).json({ success: false, message });
    try {
      const db = getDatabase(), cached = getTranslation(db, sourceKey, to);
      if (cached) return res.type('text/vtt').set('X-Translation-Cache', 'hit').send(cached.vtt);
      for (const [id, job] of jobs) if (job.expires && job.expires <= now()) jobs.delete(id);
      let job = jobs.get(key);
      if (job?.error) return fail(job.quota ? 429 : 503, job.error, job.quota ? Math.max(1, Math.ceil((quotaUntil - now()) / 1000)) : 60);
      if (quotaUntil > now()) return fail(429, 'Kuota terjemahan habis. Pilih subtitle asli atau coba lagi nanti.', Math.ceil((quotaUntil - now()) / 1000));
      if (!job) {
        if (active >= 2 || jobs.size >= 20) return fail(503, 'Penerjemah sedang sibuk. Coba kembali sebentar lagi.', 15);
        job = { completed: 0, total: 0, expires: 0, error: '', quota: false };
        jobs.set(key, job); active++;
        const run = async () => {
          try {
            const signal = AbortSignal.timeout(720_000);
            const source = await load(url, signal);
            if (!splitVtt(source).translatable.length || source.length > 200_000) throw new Error('Invalid subtitle document');
            const result = await translate(source, to, { source: from, signal,
              onProgress: (completed, total) => { job.completed = completed; job.total = total; } });
            if (result.failed > 0 || !result.translated) throw new Error('Incomplete translation');
            putTranslation(db, sourceKey, to, result.provider, result.vtt);
            jobs.delete(key);
          } catch (error) {
            job.quota = Boolean(error && error.quota === true);
            if (job.quota) quotaUntil = now() + 3_600_000;
            job.error = job.quota ? 'Kuota terjemahan habis. Pilih subtitle asli atau coba lagi nanti.'
              : 'Terjemahan belum tersedia. Gunakan subtitle asli atau coba kembali sebentar lagi.';
            job.expires = now() + (job.quota ? 3_600_000 : 60_000);
          } finally { active--; }
        };
        void run();
      }
      res.status(202).set('Retry-After', '3').json({ success: true, results: { status: 'translating', completed: job.completed, total: job.total } });
    } catch { return fail(503, 'Layanan subtitle sedang tidak tersedia. Coba kembali sebentar lagi.'); }
  });
  return router;
}
