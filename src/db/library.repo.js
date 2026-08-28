/*
 * ======= • ======= • ======= • ======= • =======• =======
 * AniKotoAPI — library.repo.js
 * Repository: https://github.com/Shineii86/AniKotoAPI
 *
 * @description
 *   Pure data access for the CMS library (no HTTP). Upserts anime with
 *   merge-by-identity, upserts episodes, and reads back the stored library.
 *   Every function takes the db as its first argument so it can be tested
 *   against a temp database.
 *
 * @exports
 *   upsertAnime, upsertEpisode, getAnimeByAny, getAnimeById, getEpisodes,
 *   listAnime, deleteAnime, animeForAutoUpdate
 *
 * @author  Shinei Nouzen
 * @license MIT
 * ======= • ======= • ======= • ======= • =======• =======
 */

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const jarr = (v) => (Array.isArray(v) ? JSON.stringify(v) : (v ?? null));

// ---- FEATURE: Identity lookup ----
/**
 * Finds an existing anime by identity, in order: anikoto_id → mal_id →
 * anilist_id → case-insensitive title.
 */
export function getAnimeByAny(db, { anikotoId, malId, anilistId, title } = {}) {
  if (anikotoId) { const r = db.prepare("SELECT * FROM anime WHERE anikoto_id = ?").get(anikotoId); if (r) return r; }
  if (malId) { const r = db.prepare("SELECT * FROM anime WHERE mal_id = ?").get(malId); if (r) return r; }
  if (anilistId) { const r = db.prepare("SELECT * FROM anime WHERE anilist_id = ?").get(anilistId); if (r) return r; }
  if (title) { const r = db.prepare("SELECT * FROM anime WHERE lower(title) = lower(?)").get(title); if (r) return r; }
  return undefined;
}

// ---- FEATURE: Anime upsert with merge ----
/**
 * Inserts a new anime or merges into the matching existing row. On update,
 * only non-null incoming fields overwrite (auto_update always applies).
 * @returns {number} the anime id
 */
export function upsertAnime(db, rec) {
  const existing = getAnimeByAny(db, { anikotoId: rec.anikotoId, malId: rec.malId, anilistId: rec.anilistId, title: rec.title });
  const fields = {
    anikoto_id: rec.anikotoId ?? null, mal_id: rec.malId ?? null, anilist_id: rec.anilistId ?? null,
    slug: rec.slug ?? null, title: rec.title, japanese_title: rec.japaneseTitle ?? null,
    poster: rec.poster ?? null, banner: rec.banner ?? null, synopsis: rec.synopsis ?? null,
    type: rec.type ?? null, status: rec.status ?? null, genres: jarr(rec.genres), studios: jarr(rec.studios),
    rating: rec.rating ?? null, total_episodes: rec.totalEpisodes ?? null,
    auto_update: rec.autoUpdate ? 1 : 0,
  };
  if (existing) {
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (k === "auto_update" || v !== null) { sets.push(`${k} = ?`); vals.push(v); }
    }
    sets.push("updated_at = ?"); vals.push(now());
    vals.push(existing.id);
    db.prepare(`UPDATE anime SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    return existing.id;
  }
  const cols = Object.keys(fields).concat(["created_at", "updated_at"]);
  const placeholders = cols.map(() => "?").join(", ");
  const vals = Object.values(fields).concat([now(), now()]);
  const info = db.prepare(`INSERT INTO anime (${cols.join(", ")}) VALUES (${placeholders})`).run(...vals);
  return info.lastInsertRowid;
}

// ---- FEATURE: Episode upsert ----
/**
 * Inserts or updates one episode by (anime_id, number). sub/dub are OR-merged;
 * text fields keep their old value when the incoming one is null.
 */
export function upsertEpisode(db, animeId, ep) {
  db.prepare(`
    INSERT INTO episode (anime_id, number, title, sub, dub, server_ids, embed_url, source, created_at, updated_at)
    VALUES (@anime_id, @number, @title, @sub, @dub, @server_ids, @embed_url, @source, @now, @now)
    ON CONFLICT(anime_id, number) DO UPDATE SET
      title = COALESCE(excluded.title, episode.title),
      sub = MAX(episode.sub, excluded.sub),
      dub = MAX(episode.dub, excluded.dub),
      server_ids = COALESCE(excluded.server_ids, episode.server_ids),
      embed_url = COALESCE(excluded.embed_url, episode.embed_url),
      source = excluded.source,
      updated_at = @now
  `).run({
    anime_id: animeId, number: ep.number, title: ep.title ?? null,
    sub: ep.sub ? 1 : 0, dub: ep.dub ? 1 : 0,
    server_ids: ep.serverIds ?? null, embed_url: ep.embedUrl ?? null,
    source: ep.source, now: now(),
  });
}

// ---- FEATURE: Reads ----
export const getEpisodes = (db, animeId) =>
  db.prepare("SELECT * FROM episode WHERE anime_id = ? ORDER BY number").all(animeId);
export const listAnime = (db, { limit = 50, offset = 0 } = {}) =>
  db.prepare("SELECT * FROM anime ORDER BY updated_at DESC LIMIT ? OFFSET ?").all(limit, offset);
export const getAnimeById = (db, id) => db.prepare("SELECT * FROM anime WHERE id = ?").get(id);
export const deleteAnime = (db, id) => db.prepare("DELETE FROM anime WHERE id = ?").run(id);
export const animeForAutoUpdate = (db) => db.prepare("SELECT * FROM anime WHERE auto_update = 1").all();

// ---- FEATURE: Library serving reads (Phase E) ----
/** Parse the JSON columns of an anime row into arrays. */
export function parseAnime(row) {
  if (!row) return row;
  const p = (s) => { try { return JSON.parse(s); } catch { return []; } };
  return { ...row, genres: p(row.genres), studios: p(row.studios) };
}

/** Home sections derived from the stored library. */
export function homeSections(db) {
  // 60 rather than 24: the home grid pages this anyway, and the schedule
  // matches its rows against the full list to decide what is clickable.
  const latest = listAnime(db, { limit: 60 }).map(parseAnime);
  const top = db.prepare(
    // 12 so the home grid fills two rows of six. The Top Anime rail slices
    // this back to 10 itself.
    "SELECT * FROM anime WHERE rating IS NOT NULL ORDER BY CAST(rating AS REAL) DESC LIMIT 12"
  ).all().map(parseAnime);
  const spotlights = latest.slice(0, 6);
  const genres = [...new Set(latest.flatMap((a) => a.genres))].sort();
  return { spotlights, latest, top, genres };
}

/** Title search across the library. */
export function searchAnime(db, keyword, limit = 24) {
  return db.prepare("SELECT * FROM anime WHERE title LIKE ? ORDER BY updated_at DESC LIMIT ?")
    .all(`%${keyword}%`, limit).map(parseAnime);
}
