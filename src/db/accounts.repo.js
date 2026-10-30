import { AccountError } from '../services/accountError.js';

/** @param {import('../services/accounts.types.js').AccountRow} row */
export function publicAccount(row) {
  return { id: row.id, email: row.email, displayName: row.display_name, createdAt: row.created_at };
}

/** @param {import('better-sqlite3').Database} db */
export function createAccountRepository(db) {
  const findEmail = db.prepare('SELECT * FROM user_accounts WHERE email = ? COLLATE NOCASE');
  const insert = db.prepare('INSERT INTO user_accounts (email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)');
  const findGoogle = db.prepare(`SELECT a.* FROM user_google_identities g JOIN user_accounts a ON a.id = g.user_id WHERE g.subject = ?`);
  const googleForUser = db.prepare('SELECT subject FROM user_google_identities WHERE user_id = ?');
  const insertGoogle = db.prepare('INSERT INTO user_google_identities (subject, user_id, linked_at) VALUES (?, ?, ?)');
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
  const linkGoogle = (id, subject, now) => {
    const owner = findGoogle.get(subject), existing = googleForUser.get(id);
    if ((owner && owner.id !== id) || (existing && existing.subject !== subject)) throw new AccountError('Akun ini sudah memiliki tautan Google lain.', 409, 'identity_in_use');
    if (!existing) insertGoogle.run(subject, id, now);
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
    googleLogin: db.transaction((identity, tokenHash, now, expiry, previous, linkUserId = null) => {
      if (linkUserId !== null) linkGoogle(linkUserId, identity.subject, now);
      let row = findGoogle.get(identity.subject);
      if (!row) {
        if (findEmail.get(identity.email)) throw new AccountError('Email ini sudah terdaftar. Login dengan kata sandi, lalu tautkan Google melalui halaman Akun.', 409, 'existing_account');
        const result = insert.run(identity.email, identity.displayName, '!google-only', now);
        const id = Number(result.lastInsertRowid);
        insertGoogle.run(identity.subject, id, now);
        row = { id, email: identity.email, display_name: identity.displayName, created_at: now };
      }
      session(row.id, tokenHash, now, expiry, previous);
      return publicAccount(row);
    }),
    googleLinked: id => Boolean(googleForUser.get(id)),
    current(tokenHash, now) {
      const row = findSession.get(tokenHash, now);
      if (row) return publicAccount(row);
      removeSession.run(tokenHash);
      return null;
    },
    logout: tokenHash => removeSession.run(tokenHash),
  };
}
