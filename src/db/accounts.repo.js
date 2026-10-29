/** @param {import('../services/accounts.types.js').AccountRow} row */
export function publicAccount(row) {
  return { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at };
}

/** @param {import('better-sqlite3').Database} db */
export function createAccountRepository(db) {
  const findEmail = db.prepare('SELECT * FROM user_accounts WHERE email = ? COLLATE NOCASE');
  const insert = db.prepare('INSERT INTO user_accounts (email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)');
  const removeExpired = db.prepare('DELETE FROM user_sessions WHERE expires_at <= ?');
  const removeSession = db.prepare('DELETE FROM user_sessions WHERE token_hash = ?');
  const trimSessions = db.prepare(`DELETE FROM user_sessions WHERE user_id = ? AND token_hash NOT IN
    (SELECT token_hash FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 4)`);
  const insertSession = db.prepare('INSERT INTO user_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)');
  const findSession = db.prepare(`SELECT a.* FROM user_sessions s JOIN user_accounts a ON a.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`);
  const session = (id, tokenHash, now, expiry, previous) => {
    removeExpired.run(now);
    if (previous) removeSession.run(previous);
    trimSessions.run(id, id);
    insertSession.run(tokenHash, id, now, expiry);
  };
  return {
    findEmail: email => findEmail.get(email),
    register: db.transaction((email, name, passwordHash, tokenHash, now, expiry, previous) => {
      const result = insert.run(email, name, passwordHash, now);
      const id = Number(result.lastInsertRowid);
      session(id, tokenHash, now, expiry, previous);
      return { id, email, displayName: name, createdAt: now };
    }),
    login: db.transaction(session),
    current(tokenHash, now) {
      const row = findSession.get(tokenHash, now);
      if (row) return publicAccount(row);
      removeSession.run(tokenHash);
      return null;
    },
    logout: tokenHash => removeSession.run(tokenHash),
  };
}
