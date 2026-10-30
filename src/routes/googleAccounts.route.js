import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { googleConfiguration, createGoogleProvider } from '../services/googleOAuth.js';
import { createGoogleFlowRepository } from '../db/googleFlows.repo.js';
import { AccountError } from '../services/accountError.js';
import { safeReturnPath } from '../../public/assets/accounts.js';
import { accountCookieOptions, readAccountCookie, writeAccountSession } from './accountCookies.js';

const age = 10 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
const opaque = value => typeof value === 'string' && /^[\w-]{43}$/.test(value);
const failures = new Set(['existing_account', 'identity_in_use', 'verification_failed', 'busy']);

/** @param {() => import('better-sqlite3').Database} getDatabase
 * @param {ReturnType<import('../services/accounts.js').createAccountService>} accounts
 * @param {{now?: () => number, configuration?: import('../services/googleOAuth.types.js').GoogleConfiguration | null, provider?: import('../services/googleOAuth.types.js').GoogleProvider}} [options] */
export function createGoogleAccountsRouter(getDatabase, accounts, { now = Date.now, configuration = googleConfiguration(), provider = configuration ? createGoogleProvider(configuration) : null } = {}) {
  const router = Router();
  let repository;
  let exchanging = 0;
  const repo = () => repository ||= createGoogleFlowRepository(getDatabase());
  const secure = configuration?.redirectUri.startsWith('https:') || false;
  const cookieName = secure ? '__Host-anijs_google_flow' : 'anijs_google_flow';
  const cookieOptions = req => ({ ...accountCookieOptions(req), secure });
  const available = req => Boolean(provider && configuration && new URL(configuration.redirectUri).host === req.get('host'));
  const errorLocation = (code, next, linked = false) => (linked ? '/account?' : '/login?') + new URLSearchParams({ google: code, next: safeReturnPath(next) });
  router.use((req, res, next) => { res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });
  router.get('/status', (req, res) => {
    const user = accounts.current(readAccountCookie(req));
    res.json({ success: true, results: { enabled: available(req), linked: Boolean(user && accounts.googleLinked(user.id)) } });
  });
  function start(req, res, userId = null) {
    if (!available(req)) throw new AccountError('Login Google belum diaktifkan.', 503, 'unavailable');
    if (req.get('sec-fetch-site') === 'cross-site') throw new AccountError('Mulai login Google dari halaman website ini.', 403, 'failed');
    const state = randomBytes(32).toString('base64url'), browser = randomBytes(32).toString('base64url');
    const verifier = randomBytes(64).toString('base64url'), nonce = randomBytes(32).toString('base64url');
    const next = userId === null ? safeReturnPath(req.query.next) : '/account';
    const previous = readAccountCookie(req, cookieName);
    repo().create({ stateHash: hash(state), browserHash: hash(browser), verifier, nonce, next, userId, expiresAt: now() + age }, now(), opaque(previous) ? hash(previous) : null);
    res.cookie(cookieName, browser, { ...cookieOptions(req), maxAge: age });
    return provider.authorize(state, nonce, verifier);
  }
  router.get('/start', (req, res) => {
    try { res.redirect(303, start(req, res)); }
    catch (error) { res.redirect(303, errorLocation(error instanceof AccountError && error.code === 'unavailable' ? 'unavailable' : 'failed', req.query.next)); }
  });
  router.post('/link', (req, res) => {
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) throw new AccountError('Data penautan tidak valid.');
      const user = accounts.current(readAccountCookie(req));
      if (!user) throw new AccountError('Login terlebih dahulu untuk menautkan Google.', 401);
      res.json({ success: true, results: { url: start(req, res, user.id) } });
    } catch (error) { res.status(error instanceof AccountError ? error.status : 500).json({ success: false, message: error instanceof AccountError ? error.message : 'Google belum dapat ditautkan. Coba lagi nanti.' }); }
  });
  router.get('/callback', async (req, res) => {
    /** @type {import('../services/googleOAuth.types.js').StoredGoogleFlow | undefined} */
    let flow;
    try {
      const browser = readAccountCookie(req, cookieName), state = req.query.state;
      if (!available(req) || !opaque(state) || !opaque(browser)) return res.redirect(303, errorLocation('expired', '/home'));
      flow = repo().take(hash(state), hash(browser), now());
      if (!flow) return res.redirect(303, errorLocation('expired', '/home'));
      res.clearCookie(cookieName, cookieOptions(req));
      if (req.query.error) return res.redirect(303, errorLocation(req.query.error === 'access_denied' ? 'cancelled' : 'failed', flow.return_path, flow.user_id !== null));
      if (typeof req.query.code !== 'string' || !req.query.code || req.query.code.length > 4096 || /[\x00-\x20\x7f]/.test(req.query.code)) throw new AccountError('Kode Google tidak valid.', 400, 'verification_failed');
      if (exchanging >= 4) throw new AccountError('Login Google sedang sibuk.', 503, 'busy');
      exchanging++;
      let identity;
      try { identity = await provider.exchange(req.query.code, flow.verifier, flow.nonce); }
      finally { exchanging--; }
      if (flow.user_id !== null) {
        const user = accounts.current(readAccountCookie(req));
        if (!user || user.id !== flow.user_id) return res.redirect(303, errorLocation('expired', '/account'));
      }
      const result = accounts.googleLogin(identity, readAccountCookie(req), flow.user_id);
      writeAccountSession(req, res, result.token, secure);
      res.redirect(303, flow.user_id === null ? safeReturnPath(flow.return_path) : '/account?google=linked');
    } catch (error) {
      const code = error instanceof AccountError && failures.has(error.code) ? error.code : 'verification_failed';
      res.redirect(303, errorLocation(code, flow?.return_path || '/home', flow?.user_id !== null && flow?.user_id !== undefined));
    }
  });
  return router;
}
