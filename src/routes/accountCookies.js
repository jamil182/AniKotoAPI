import { SESSION_AGE_MS } from '../services/accounts.js';

export const sessionCookie = 'anijs_session';
/** @param {import('express').Request} req @param {string} name */
export function readAccountCookie(req, name = sessionCookie) {
  return (req.get('cookie') || '').split(';').find(entry => entry.trim().startsWith(name + '='))?.trim().slice(name.length + 1);
}
/** @param {import('express').Request} req */
export const accountCookieOptions = req => ({ httpOnly: true, sameSite: /** @type {const} */ ('lax'), path: '/',
  secure: req.secure || req.get('x-forwarded-proto') === 'https' });

/** @param {import('express').Request} req @param {import('express').Response} res @param {string} token @param {boolean} [secure] */
export function writeAccountSession(req, res, token, secure = false) {
  res.cookie(sessionCookie, token, { ...accountCookieOptions(req), secure: secure || accountCookieOptions(req).secure, maxAge: SESSION_AGE_MS });
}
