/** @param {import('better-sqlite3').Database} db */
export function migrateVisitors(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS visitor_settings (id INTEGER PRIMARY KEY CHECK(id=1), secret TEXT NOT NULL,
      started_at INTEGER NOT NULL, visits INTEGER NOT NULL DEFAULT 0, pageviews INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, ip TEXT NOT NULL, path TEXT NOT NULL,
      first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, views INTEGER NOT NULL DEFAULT 0,
      country TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
      geo_status TEXT NOT NULL DEFAULT 'unavailable', geo_at INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS ix_visitors_seen ON visitors(last_seen DESC);
    CREATE TABLE IF NOT EXISTS visitor_events (visitor_id TEXT NOT NULL, event_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, PRIMARY KEY(visitor_id,event_id));
    CREATE INDEX IF NOT EXISTS ix_visitor_events_created ON visitor_events(created_at);
    CREATE TABLE IF NOT EXISTS visitor_daily (day TEXT PRIMARY KEY, visitors INTEGER NOT NULL DEFAULT 0,
      visits INTEGER NOT NULL DEFAULT 0, pageviews INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS visitor_daily_seen (day TEXT NOT NULL, visitor_id TEXT NOT NULL,
      PRIMARY KEY(day, visitor_id));
  `);
}
