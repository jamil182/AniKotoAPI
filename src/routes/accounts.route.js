import { Router } from 'express';
import { createAccountService, SESSION_AGE_MS } from '../services/accounts.js';
import { AccountError } from '../services/accountError.js';

const cookieName = 'anijs_session';
function readToken(req) {
  const entries = (req.get('cookie') || '').split(';');
  const token = entries.find(entry => entry.trim().startsWith(cookieName + '='));
  return token?.trim().slice(cookieName.length + 1);
}
const cookieOptions = req => ({
  httpOnly: true, sameSite: 'lax', path: '/',
  secure: req.secure || req.get('x-forwarded-proto') === 'https',
});

/** @param {() => import('better-sqlite3').Database} getDatabase */
export function createAccountsRouter(getDatabase, { now = Date.now, maxAttempts = 10 } = {}) {
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
    if (!['/login', '/register'].includes(req.path)) return next();
    const time = now();
    for (const [key, value] of attempts) if (value.until <= time) attempts.delete(key);
    const key = req.ip;
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
      res.cookie(cookieName, result.token, { ...cookieOptions(req), maxAge: SESSION_AGE_MS });
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
