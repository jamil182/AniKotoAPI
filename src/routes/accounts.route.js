import { Router } from 'express';
import { createAccountService } from '../services/accounts.js';
import { AccountError } from '../services/accountError.js';
import { accountCookieOptions as cookieOptions, readAccountCookie as readToken, sessionCookie as cookieName, writeAccountSession } from './accountCookies.js';
import { createGoogleAccountsRouter } from './googleAccounts.route.js';
import { visitorAddress } from '../services/visitorAddress.js';

/** @param {() => import('better-sqlite3').Database} getDatabase */
export function createAccountsRouter(getDatabase, { now = Date.now, maxAttempts = 10, google = {} } = {}) {
  const service = createAccountService(getDatabase, { now });
  const router = Router();
  const attempts = new Map();
  router.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use((req, res, next) => {
    if (req.method === 'GET') return next();
    const origin = req.get('origin');
    let sameOrigin = !origin;
    if (origin) {
      try { const parsed = new URL(origin); sameOrigin = ['http:', 'https:'].includes(parsed.protocol) && parsed.host === req.get('host'); }
      catch { sameOrigin = false; }
    }
    if (!sameOrigin || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ success: false, message: 'Permintaan lintas situs ditolak.' });
    if (!req.is('application/json')) return res.status(415).json({ success: false, message: 'Gunakan format JSON.' });
    next();
  });
  router.use((req, res, next) => {
    if (!(req.method === 'POST' && ['/login', '/register', '/google/link'].includes(req.path)) && !(req.method === 'GET' && req.path === '/google/start')) return next();
    const time = now();
    for (const [key, value] of attempts) if (value.until <= time) attempts.delete(key);
    const key = visitorAddress(req) || req.ip;
    const limit = attempts.get(key) || { count: 0, until: time + 15 * 60 * 1000 };
    if (limit.count >= maxAttempts) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((limit.until - time) / 1000))));
      return res.status(429).json({ success: false, message: 'Terlalu banyak percobaan. Coba lagi setelah 15 menit.' });
    }
    if (!attempts.has(key) && attempts.size >= 1000) attempts.delete(attempts.keys().next().value);
    limit.count++;
    attempts.set(key, limit);
    next();
  });
  router.use('/google', createGoogleAccountsRouter(getDatabase, service, { ...google, now }));
  const handle = (method, path, action) => router[method](path, async (req, res) => {
    try { await action(req, res); }
    catch (error) {
      if (!(error instanceof AccountError)) console.error('[ACCOUNTS]', error.code || error.name);
      res.status(error instanceof AccountError ? error.status : 500).json({ success: false, message: error instanceof AccountError ? error.message : 'Layanan akun sedang bermasalah. Coba lagi nanti.' });
    }
  });
  handle('get', '/me', (req, res) => res.json({ success: true, results: { user: service.current(readToken(req)) } }));
  for (const action of ['register', 'login']) {
    handle('post', '/' + action, async (req, res) => {
      const result = await service[action](req.body, readToken(req));
      writeAccountSession(req, res, result.token);
      res.status(action === 'register' ? 201 : 200).json({ success: true, results: { user: result.user } });
    });
  }
  handle('post', '/logout', (req, res) => {
    service.logout(readToken(req));
    res.clearCookie(cookieName, cookieOptions(req));
    res.json({ success: true, results: { user: null } });
  });
  return router;
}
