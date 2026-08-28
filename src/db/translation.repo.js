/*
 * ======= • ======= • ======= • ======= • =======• =======
 * AniKotoAPI — translation.repo.js
 * Repository: https://github.com/Shineii86/AniKotoAPI
 *
 * @description
 *   Pure data access for cached machine-translated subtitle tracks (no HTTP).
 *   A translation costs provider quota and takes seconds to produce, so every
 *   finished track is stored and reused for the next viewer of that episode.
 *   Every function takes the db as its first argument so it can be tested
 *   against a temp database.
 *
 * @exports
 *   getTranslation, putTranslation, countTranslations
 *
 * @author  Shinei Nouzen
 * @license MIT
 * ======= • ======= • ======= • ======= • =======• =======
 */

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

// ---- FEATURE: Cache lookup ----
/**
 * Reads a previously translated track.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} sourceUrl - the source VTT url the translation came from
 * @param {string} targetLang - BCP-47-ish target code, e.g. "id"
 * @returns {{vtt: string, provider: string, created_at: string}|undefined}
 */
export function getTranslation(db, sourceUrl, targetLang) {
  return db
    .prepare("SELECT vtt, provider, created_at FROM subtitle_translation WHERE source_url = ? AND target_lang = ?")
    .get(sourceUrl, targetLang);
}

// ---- FEATURE: Cache write ----
/**
 * Stores a translated track, replacing any earlier one for the same
 * source/target pair (a re-translation is assumed to be the better copy).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} sourceUrl
 * @param {string} targetLang
 * @param {string} provider - which service produced it, for later auditing
 * @param {string} vtt - the finished WebVTT document
 * @returns {void}
 */
export function putTranslation(db, sourceUrl, targetLang, provider, vtt) {
  db.prepare(
    `INSERT INTO subtitle_translation (source_url, target_lang, provider, vtt, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(source_url, target_lang)
     DO UPDATE SET provider = excluded.provider, vtt = excluded.vtt, created_at = excluded.created_at`
  ).run(sourceUrl, targetLang, provider, vtt, now());
}

// ---- FEATURE: Cache size ----
/**
 * Number of cached tracks, for status reporting.
 * @param {import('better-sqlite3').Database} db
 * @returns {number}
 */
export function countTranslations(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM subtitle_translation").get().n;
}

// ══════════════════════════════════════════════════════════════ END: translation.repo.js
