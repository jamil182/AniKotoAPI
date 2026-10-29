/*
 * ======= • ======= • ======= • ======= • =======• =======
 * AniKotoAPI — db.js
 * Repository: https://github.com/Shineii86/AniKotoAPI
 *
 * @description
 *   SQLite connection for the admin CMS. Opens (creating dirs as needed),
 *   enables WAL + foreign keys, and runs the idempotent migrations that
 *   create the `anime` and `episode` tables.
 *
 * @exports
 *   openDb, migrate
 *
 * @author  Shinei Nouzen
 * @license MIT
 * ======= • ======= • ======= • ======= • =======• =======
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { migrateVisitors } from './visitors.schema.js';

const DEFAULT_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "anikoto.db");

// ---- FEATURE: Schema migration ----
/**
 * Creates the CMS tables if they do not already exist.
 * @param {import('better-sqlite3').Database} db
 */
export function migrate(db) {
  migrateVisitors(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_user_sessions_user ON user_sessions(user_id, created_at);
    CREATE INDEX IF NOT EXISTS ix_user_sessions_expiry ON user_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS anime (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anikoto_id INTEGER, mal_id INTEGER, anilist_id INTEGER,
      slug TEXT, title TEXT NOT NULL, japanese_title TEXT,
      poster TEXT, banner TEXT, synopsis TEXT, type TEXT, status TEXT,
      genres TEXT, studios TEXT, rating TEXT, total_episodes INTEGER,
      auto_update INTEGER DEFAULT 0,
      created_at TEXT, updated_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_anime_anikoto ON anime(anikoto_id) WHERE anikoto_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_anime_mal ON anime(mal_id) WHERE mal_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_anime_anilist ON anime(anilist_id) WHERE anilist_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS episode (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
      number INTEGER NOT NULL, title TEXT,
      sub INTEGER DEFAULT 0, dub INTEGER DEFAULT 0,
      server_ids TEXT, embed_url TEXT, source TEXT,
      created_at TEXT, updated_at TEXT,
      UNIQUE(anime_id, number)
    );
    -- Machine-translated subtitle tracks, keyed on the source VTT and target
    -- language. Translating an episode costs real API quota, so a hit here is
    -- what keeps every viewer after the first one free.
    CREATE TABLE IF NOT EXISTS subtitle_translation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url TEXT NOT NULL,
      target_lang TEXT NOT NULL,
      provider TEXT NOT NULL,
      vtt TEXT NOT NULL,
      created_at TEXT,
      UNIQUE(source_url, target_lang)
    );
  `);

  // Added after the table first shipped. SQLite has no ADD COLUMN IF NOT
  // EXISTS, so check what is already there rather than catching an error.
  const cols = new Set(db.prepare("PRAGMA table_info(anime)").all().map((c) => c.name));
  if (!cols.has("year")) db.exec("ALTER TABLE anime ADD COLUMN year INTEGER");
  if (!cols.has("duration")) db.exec("ALTER TABLE anime ADD COLUMN duration TEXT");
  if (!cols.has("publication_state")) db.exec("ALTER TABLE anime ADD COLUMN publication_state TEXT NOT NULL DEFAULT 'draft' CHECK (publication_state IN ('draft', 'published'))");
  if (!cols.has("published_at")) db.exec("ALTER TABLE anime ADD COLUMN published_at TEXT");
  if (!cols.has("last_synced_at")) db.exec("ALTER TABLE anime ADD COLUMN last_synced_at TEXT");
  if (!cols.has("allow_sub")) db.exec("ALTER TABLE anime ADD COLUMN allow_sub INTEGER NOT NULL DEFAULT 1");
  if (!cols.has("allow_dub")) db.exec("ALTER TABLE anime ADD COLUMN allow_dub INTEGER NOT NULL DEFAULT 1");
  if (!cols.has("source_slug")) db.exec("ALTER TABLE anime ADD COLUMN source_slug TEXT");
  const episodeCols = new Set(db.prepare("PRAGMA table_info(episode)").all().map(c => c.name));
  if (!episodeCols.has("mal_id")) db.exec("ALTER TABLE episode ADD COLUMN mal_id INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS ix_anime_publication ON anime(publication_state, published_at)");
}

// ---- FEATURE: Connection ----
/**
 * Opens the SQLite database, applying pragmas and migrations.
 * @param {string} [file] - path to the .db file (default data/anikoto.db)
 * @returns {import('better-sqlite3').Database}
 */
export function openDb(file = DEFAULT_PATH) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}
