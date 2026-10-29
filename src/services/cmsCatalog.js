import { AniKotoError } from './anikotoApi.js';
import { getAnimeByAny, upsertAnime } from '../db/library.repo.js';
import { cmsAnime, storeNativeEpisodes } from '../db/cms.repo.js';

function sourceImage(value) {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

export async function importCatalogSeries(db, client, { slug, sub = true, dub = true, autoUpdate = true }) {
  const [info, result] = await Promise.all([client.get('/info', { id: slug }), client.get(`/episodes/${slug}`)]);
  if (typeof info?.title !== 'string' || !info.title.trim() || !Array.isArray(result?.episodes)) throw new AniKotoError('Data anime tidak lengkap dari AniKotoAPI.');
  return db.transaction(() => {
    const existing = db.prepare('SELECT * FROM anime WHERE source_slug = ? OR slug = ?').get(slug, slug)
      || getAnimeByAny(db, { anikotoId: Number(info.animeId) || undefined });
    const id = existing?.id || upsertAnime(db, {
      anikotoId: Number(info.animeId) || null, slug, title: info.title,
      japaneseTitle: info.japaneseTitle, poster: sourceImage(info.poster), banner: sourceImage(info.backgroundImage),
      synopsis: info.synopsis, type: info.type, status: info.status,
      genres: info.genres || [], studios: info.studios || [], rating: info.malScore || info.rating,
      duration: info.duration, autoUpdate,
    });
    db.prepare('UPDATE anime SET source_slug = ?, auto_update = ?, allow_sub = ?, allow_dub = ? WHERE id = ?')
      .run(slug, Number(autoUpdate), Number(sub), Number(dub), id);
    const sync = storeNativeEpisodes(db, id, result.episodes);
    return { ...sync, anime: cmsAnime(db, id) };
  })();
}

export async function syncCatalogSeries(db, client, id) {
  const anime = cmsAnime(db, id);
  const slug = anime.source_slug || (anime.anikoto_id ? anime.slug : null);
  if (!slug) throw new AniKotoError('Anime ini belum memiliki sumber AniKotoAPI untuk sinkron episode.', 400);
  const result = await client.get(`/episodes/${slug}`);
  if (!Array.isArray(result?.episodes)) throw new AniKotoError('Daftar episode dari AniKotoAPI tidak valid.');
  return { ...storeNativeEpisodes(db, id, result.episodes), anime: cmsAnime(db, id) };
}

const pendingUpdates = new WeakMap();
const updateStates = new WeakMap();
export const cmsUpdateStatus = db => updateStates.get(db) || { running: false, checked: 0, total: 0, added: 0, failures: [] };
export function runCmsUpdates(db, client) {
  if (pendingUpdates.has(db)) return pendingUpdates.get(db);
  const work = (async () => {
    const rows = db.prepare('SELECT id, title FROM anime WHERE auto_update = 1 AND (source_slug IS NOT NULL OR (anikoto_id IS NOT NULL AND slug IS NOT NULL))').all();
    const state = { running: true, total: rows.length, checked: 0, added: 0, failures: [], startedAt: new Date().toISOString() };
    updateStates.set(db, state);
    let added = 0;
    const failures = [];
    for (const row of rows) {
      try { added += (await syncCatalogSeries(db, client, row.id)).added; }
      catch (error) { failures.push({ animeId: row.id, title: row.title, message: error instanceof AniKotoError ? error.message : 'Gagal menghubungi AniKotoAPI.' }); }
      state.checked++; state.added = added; state.failures = [...failures];
    }
    state.running = false;
    state.finishedAt = new Date().toISOString();
    return { checked: rows.length, added, failures };
  })().finally(() => { pendingUpdates.delete(db); const state = updateStates.get(db); if (state) state.running = false; });
  pendingUpdates.set(db, work);
  return work;
}

export function startCmsScheduler(db, client, intervalMs = 3600000) {
  const tick = () => runCmsUpdates(db, client).catch(error => console.error('[CMS SYNC]', error.message));
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
