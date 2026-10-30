/** @param {import('better-sqlite3').Database} db */
export function migrateGoogleAccounts(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_google_identities (
      subject TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES user_accounts(id) ON DELETE CASCADE,
      linked_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS google_login_flows (
      state_hash TEXT PRIMARY KEY,
      browser_hash TEXT NOT NULL,
      verifier TEXT NOT NULL,
      nonce TEXT NOT NULL,
      return_path TEXT NOT NULL,
      user_id INTEGER REFERENCES user_accounts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_google_flow_expiry ON google_login_flows(expires_at);
    CREATE INDEX IF NOT EXISTS ix_google_flow_browser ON google_login_flows(browser_hash);
  `);
}
