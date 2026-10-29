import { randomInt } from 'node:crypto';
import { getAnimeById, getEpisodes, parseAnime, upsertEpisode } from './library.repo.js';
import { AniKotoError } from '../services/anikotoApi.js';

export const publicSlug = anime => anime.slug || `library-${anime.id}`;

/** @returns {import('../services/cmsCatalog.types.js').CmsAnime} */
export function cmsAnime(db, id) {
  const anime = parseAnime(getAnimeById(db, id));
  if (!anime) throw new AniKotoError('Anime tidak ditemukan.', 404);
  return { ...anime, public_slug: publicSlug(anime), episode_count: getEpisodes(db, id).length };
}

export function cmsList(db) {
  return db.prepare(`SELECT a.*, (SELECT COUNT(*) FROM episode e WHERE e.anime_id = a.id) AS episode_count
    FROM anime a ORDER BY julianday(a.updated_at) DESC, a.id DESC`).all().map(row => ({ ...parseAnime(row), public_slug: publicSlug(row) }));
}

export function publishedAnime(db, slug) {
  const local = /^library-([1-9]\d*)$/.exec(slug);
  const row = local
    ? db.prepare("SELECT * FROM anime WHERE id = ? AND publication_state = 'published'").get(Number(local[1]))
    : db.prepare("SELECT * FROM anime WHERE slug = ? AND publication_state = 'published'").get(slug);
  if (!row || publicSlug(row) !== slug) throw new AniKotoError('Anime belum dipublikasikan atau tidak ditemukan.', 404);
  return parseAnime(row);
}

export function catalogAnime(db, row) {
  const counts = typeof row.episode_count === 'number' ? row : db.prepare(`SELECT COUNT(*) AS episode_count,
    COALESCE(SUM(sub), 0) AS sub_count, COALESCE(SUM(dub), 0) AS dub_count FROM episode WHERE anime_id = ?`).get(row.id);
  return {
    ...parseAnime(row), id: publicSlug(row), slug: publicSlug(row),
    japaneseTitle: row.japanese_title, backgroundImage: row.banner,
    sub: row.allow_sub ? counts.sub_count : 0,
    dub: row.allow_dub ? counts.dub_count : 0,
    total: counts.episode_count,
  };
}

export function storedEpisodes(db, row) {
  const episodes = getEpisodes(db, row.id).map(ep => ({
    ...ep, episode_no: ep.number, mal_id: ep.mal_id || row.mal_id || null,
  }));
  return { slug: publicSlug(row), animeId: row.anikoto_id, totalEpisodes: episodes.length, episodes };
}

export function updateCmsAnime(db, id, fields) {
  return db.transaction(() => {
    const current = cmsAnime(db, id);
    if (fields.publication_state === 'published' && !current.episode_count) throw new AniKotoError('Tambahkan minimal satu episode sebelum Publish.', 400);
    const columns = Object.keys(fields);
    const allowed = new Set(['title', 'slug', 'japanese_title', 'poster', 'banner', 'synopsis', 'type', 'status', 'genres', 'rating', 'auto_update', 'allow_sub', 'allow_dub', 'publication_state']);
    if (columns.some(column => !allowed.has(column))) throw new AniKotoError('Kolom perubahan tidak didukung.', 400);
    if (!columns.length) throw new AniKotoError('Tidak ada perubahan yang dikirim.', 400);
    if (fields.slug && db.prepare('SELECT id FROM anime WHERE slug = ? AND id <> ?').get(fields.slug, id)) throw new AniKotoError('Slug sudah digunakan anime lain.', 409);
    if ((fields.auto_update ?? current.auto_update) && !current.source_slug && !current.anikoto_id) throw new AniKotoError('Sinkron otomatis tersedia untuk anime dari AniKotoAPI.', 400);
    if (!(fields.allow_sub ?? current.allow_sub) && !(fields.allow_dub ?? current.allow_dub)) throw new AniKotoError('Pilih minimal satu bahasa video.', 400);
    const values = columns.map(key => Array.isArray(fields[key]) ? JSON.stringify(fields[key]) : fields[key]);
    const timestamp = new Date().toISOString();
    const assignments = columns.map(key => `${key} = ?`);
    assignments.push('updated_at = ?'); values.push(timestamp);
    if (fields.publication_state === 'published' && current.publication_state !== 'published') {
      assignments.push('published_at = ?'); values.push(timestamp);
    }
    db.prepare(`UPDATE anime SET ${assignments.join(', ')} WHERE id = ?`).run(...values, id);
    return cmsAnime(db, id);
  })();
}

export function storeNativeEpisodes(db, animeId, rows) {
  return db.transaction(() => {
    const anime = cmsAnime(db, animeId);
    const existing = new Set(getEpisodes(db, animeId).map(ep => ep.number));
    let added = 0;
    for (const ep of rows) {
      const number = Number(ep?.episode_no);
      if (!Number.isFinite(number) || number <= 0) continue;
      if (!ep.server_ids && !ep.mal_id) continue;
      upsertEpisode(db, animeId, {
        number, title: typeof ep.title === 'string' ? ep.title : null,
        serverIds: typeof ep.server_ids === 'string' ? ep.server_ids : null,
        malId: /^[1-9]\d*$/.test(String(ep.mal_id)) ? Number(ep.mal_id) : null,
        sub: anime.allow_sub, dub: anime.allow_dub, source: 'anikoto',
      });
      if (!existing.has(number)) { added++; existing.add(number); }
    }
    db.prepare('UPDATE anime SET total_episodes = (SELECT COUNT(*) FROM episode WHERE anime_id = ?), last_synced_at = ? WHERE id = ?')
      .run(animeId, new Date().toISOString(), animeId);
    return { animeId, added, episodeCount: existing.size };
  })();
}

export function publicRows(db) {
  return db.prepare(`SELECT a.*, COALESCE(e.episode_count, 0) AS episode_count,
      COALESCE(e.sub_count, 0) AS sub_count, COALESCE(e.dub_count, 0) AS dub_count
    FROM anime a LEFT JOIN (
      SELECT anime_id, COUNT(*) AS episode_count, SUM(sub) AS sub_count, SUM(dub) AS dub_count,
        MAX(julianday(created_at)) AS last_episode FROM episode GROUP BY anime_id
    ) e ON e.anime_id = a.id WHERE a.publication_state = 'published'
    ORDER BY COALESCE(e.last_episode, julianday(a.published_at)) DESC, a.id DESC`).all();
}

export function randomPublished(db) {
  const rows = publicRows(db);
  if (!rows.length) throw new AniKotoError('Belum ada anime yang dipublikasikan.', 404);
  return catalogAnime(db, rows[randomInt(rows.length)]);
}
