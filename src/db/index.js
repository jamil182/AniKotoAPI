/*
 * AniKotoAPI — src/db/index.js
 * Lazily-opened SQLite singleton for routes and the scheduler. Unit tests
 * use their own temp databases via openDb() and never touch this.
 */

import { openDb } from "./db.js";

let _db = null;

/** @returns {import('better-sqlite3').Database} the shared connection */
export function getDb() {
  if (!_db) _db = openDb();
  return _db;
}
