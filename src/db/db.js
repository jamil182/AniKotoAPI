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

const DEFAULT_PATH = path.join(process.cwd(), "data", "anikoto.db");

// ---- FEATURE: Schema migration ----
/**
 * Creates the CMS tables if they do not already exist.
 * @param {import('better-sqlite3').Database} db
 */
export function migrate(db) {
  db.exec(`
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
  `);
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
