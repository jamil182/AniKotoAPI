import { AccountError } from '../services/accountError.js';

/** @param {import('better-sqlite3').Database} db */
export function createGoogleFlowRepository(db) {
  const prune = db.prepare('DELETE FROM google_login_flows WHERE expires_at <= ?');
  const removeBrowser = db.prepare('DELETE FROM google_login_flows WHERE browser_hash = ?');
  const count = db.prepare('SELECT COUNT(*) AS total FROM google_login_flows');
  const insert = db.prepare(`INSERT INTO google_login_flows
    (state_hash, browser_hash, verifier, nonce, return_path, user_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const take = db.prepare(`DELETE FROM google_login_flows
    WHERE state_hash = ? AND browser_hash = ? AND expires_at > ? RETURNING *`);
  return {
    create: db.transaction((flow, now, previousBrowser) => {
      prune.run(now);
      if (previousBrowser) removeBrowser.run(previousBrowser);
      if (count.get().total >= 1000) throw new AccountError('Login Google sedang sibuk. Silakan coba lagi.', 503);
      insert.run(flow.stateHash, flow.browserHash, flow.verifier, flow.nonce, flow.next, flow.userId, flow.expiresAt);
    }),
    take: db.transaction((stateHash, browserHash, now) => {
      prune.run(now);
      return take.get(stateHash, browserHash, now);
    }),
  };
}
