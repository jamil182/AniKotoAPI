/** @param {import('better-sqlite3').Database} db */
export function migrateSynopsisTranslations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS synopsis_translations (
    cache_key TEXT PRIMARY KEY CHECK(length(cache_key) = 64),
    translated_text TEXT NOT NULL CHECK(length(translated_text) BETWEEN 1 AND 24000),
    created_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_synopsis_translation_date ON synopsis_translations(created_at);`);
}
