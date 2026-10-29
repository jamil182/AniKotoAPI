import { Router } from 'express';
import { adminAuth } from '../middleware/adminAuth.js';
import { AniKotoError, normalizeList } from '../services/anikotoApi.js';
import { cmsAnime, cmsList, updateCmsAnime } from '../db/cms.repo.js';
import { deleteAnime } from '../db/library.repo.js';
import { cmsUpdateStatus, importCatalogSeries, runCmsUpdates, syncCatalogSeries } from '../services/cmsCatalog.js';
import { importMalEpisode } from '../services/cmsMalImport.js';

function idOf(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) throw new AniKotoError('ID anime tidak valid.', 400);
  return Number(value);
}
function slugOf(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,239}$/i.test(value) || /^library-\d+$/.test(value)) throw new AniKotoError('Slug anime tidak valid. Pilih hasil pencarian atau isi slug AniKoto.', 400);
  return value;
}
function bool(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new AniKotoError('Nilai pilihan harus berupa boolean.', 400);
  return value;
}
function patchOf(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AniKotoError('Data perubahan tidak valid.', 400);
  const fields = {};
  const strings = { title: 240, japanese_title: 240, synopsis: 6000, type: 50, status: 80, rating: 30 };
  for (const [name, limit] of Object.entries(strings)) {
    if (!(name in body)) continue;
    if (typeof body[name] !== 'string' || body[name].length > limit) throw new AniKotoError(`Kolom ${name} tidak valid.`, 400);
    fields[name] = body[name].trim();
  }
  if ('title' in fields && !fields.title) throw new AniKotoError('Judul anime wajib diisi.', 400);
  if ('slug' in body) fields.slug = slugOf(body.slug);
  for (const name of ['poster', 'banner']) {
    if (!(name in body)) continue;
    if (typeof body[name] !== 'string' || body[name].length > 2048) throw new AniKotoError('URL gambar tidak valid.', 400);
    const value = body[name].trim();
    if (value) {
      let url;
      try { url = new URL(value); } catch { throw new AniKotoError('URL gambar tidak valid.', 400); }
      if (url.protocol !== 'https:' || url.username || url.password) throw new AniKotoError('URL gambar harus menggunakan HTTPS.', 400);
    }
    fields[name] = value;
  }
  for (const name of ['auto_update', 'allow_sub', 'allow_dub']) if (name in body) fields[name] = Number(bool(body[name]));
  if ('genres' in body) {
    if (!Array.isArray(body.genres) || body.genres.length > 50 || body.genres.some(value => typeof value !== 'string' || value.length > 60)) throw new AniKotoError('Daftar genre tidak valid.', 400);
    fields.genres = [...new Set(body.genres.map(value => value.trim()).filter(Boolean))];
  }
  if ('publication_state' in body) {
    if (!['draft', 'published'].includes(body.publication_state)) throw new AniKotoError('Status publikasi tidak valid.', 400);
    fields.publication_state = body.publication_state;
  }
  const supported = new Set([...Object.keys(strings), 'slug', 'poster', 'banner', 'genres', 'auto_update', 'allow_sub', 'allow_dub', 'publication_state']);
  if (Object.keys(body).some(key => !supported.has(key))) throw new AniKotoError('Ada kolom yang tidak didukung.', 400);
  return fields;
}

export function createCmsRouter(getDatabase, client) {
  const router = Router();
  router.use(adminAuth);
  router.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const handle = (method, path, fn) => router[method](path, async (req, res) => {
    try { res.json({ success: true, results: await fn(req) }); }
    catch (error) {
      if (error.retryAfter) res.setHeader('Retry-After', error.retryAfter);
      res.status(error instanceof AniKotoError ? error.status : 502).json({ success: false, message: error instanceof AniKotoError ? error.message : 'Permintaan gagal. Silakan coba lagi.' });
    }
  });
  handle('get', '/search', async req => {
    const keyword = req.query.keyword;
    if (typeof keyword !== 'string' || keyword.trim().length < 2 || keyword.length > 120) throw new AniKotoError('Ketik minimal dua huruf untuk mencari anime.', 400);
    const page = req.query.page || '1';
    if (typeof page !== 'string' || !/^[1-9]\d{0,3}$/.test(page)) throw new AniKotoError('Halaman pencarian tidak valid.', 400);
    const data = await client.get('/search', { keyword: keyword.trim(), page });
    return { data: normalizeList(data), page: Number(page), totalPages: Math.max(1, Number(data.totalPages) || 1) };
  });
  handle('get', '/library', () => cmsList(getDatabase()));
  handle('get', '/anime/:id', req => cmsAnime(getDatabase(), idOf(req.params.id)));
  handle('patch', '/anime/:id', req => updateCmsAnime(getDatabase(), idOf(req.params.id), patchOf(req.body)));
  handle('delete', '/anime/:id', req => {
    const id = idOf(req.params.id);
    const current = cmsAnime(getDatabase(), id);
    if (current.publication_state === 'published') throw new AniKotoError('Ubah anime menjadi Draft sebelum menghapusnya.', 409);
    deleteAnime(getDatabase(), id);
    return { deleted: id };
  });
  handle('post', '/import', req => {
    const body = req.body || {};
    const slug = slugOf(body.slug);
    const sub = bool(body.sub, true), dub = bool(body.dub, true);
    if (!sub && !dub) throw new AniKotoError('Pilih minimal satu bahasa video.', 400);
    return importCatalogSeries(getDatabase(), client, { slug, sub, dub, autoUpdate: bool(body.autoUpdate, true) });
  });
  handle('post', '/anime/:id/sync', req => syncCatalogSeries(getDatabase(), client, idOf(req.params.id)));
  handle('post', '/fetch-mal', req => {
    const body = req.body || {};
    if (!['mal', 'anilist'].includes(body.source)) throw new AniKotoError('Sumber harus MAL atau AniList.', 400);
    const id = idOf(body.id);
    if (typeof body.episode !== 'string' || !/^\d+(?:\.\d+)?$/.test(body.episode) || Number(body.episode) <= 0 || body.episode.length > 10) throw new AniKotoError('Nomor episode tidak valid.', 400);
    const sub = bool(body.sub, true), dub = bool(body.dub, false);
    if (!sub && !dub) throw new AniKotoError('Pilih minimal satu bahasa.', 400);
    return importMalEpisode(getDatabase(), { source: body.source, id, episode: body.episode, sub, dub });
  });
  handle('post', '/run-updates', () => runCmsUpdates(getDatabase(), client));
  handle('post', '/sync-all', () => {
    const db = getDatabase();
    runCmsUpdates(db, client).catch(error => console.error('[CMS SYNC]', error.message));
    return cmsUpdateStatus(db);
  });
  handle('get', '/sync-status', () => cmsUpdateStatus(getDatabase()));
  return router;
}
