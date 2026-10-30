/** @param {import('better-sqlite3').Database} db */
export function migrateComments(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS anime_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anime_slug TEXT NOT NULL,
      episode REAL NOT NULL CHECK (episode >= 0 AND episode <= 100000),
      user_id INTEGER NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES anime_comments(id) ON DELETE CASCADE,
      body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
      spoiler INTEGER NOT NULL DEFAULT 0 CHECK (spoiler IN (0, 1)),
      request_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      deleted_at INTEGER,
      deleted_by_admin INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS ix_comments_thread ON anime_comments(anime_slug, episode, parent_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS ix_comments_parent ON anime_comments(parent_id, created_at, id);
    CREATE INDEX IF NOT EXISTS ix_comments_user ON anime_comments(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS comment_likes (
      comment_id INTEGER NOT NULL REFERENCES anime_comments(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
      PRIMARY KEY(comment_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS anime_reactions (
      anime_slug TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
      mood TEXT NOT NULL CHECK (mood IN ('peak','mid','crying','sus','angry','good','funny','shocked','wholesome')),
      PRIMARY KEY(anime_slug, user_id)
    );
  `);
}
