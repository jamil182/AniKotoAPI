import { createHash, randomBytes } from 'node:crypto';
import { createAccountRepository, publicAccount } from '../db/accounts.repo.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { AccountError } from './accountError.js';

export const SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const digest = token => createHash('sha256').update(token).digest('hex');
const sessionHash = token => typeof token === 'string' && /^[\w-]{43}$/.test(token) ? digest(token) : null;

function input(body, registration) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AccountError('Data akun tidak valid.');
  const fields = registration ? ['displayName', 'email', 'password'] : ['email', 'password'];
  if (Object.keys(body).some(key => !fields.includes(key))) throw new AccountError('Ada kolom akun yang tidak didukung.');
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new AccountError('Masukkan alamat email yang valid.');
  if (typeof body.password !== 'string' || body.password.length < 15 || body.password.length > 128 || !body.password.trim()) {
    throw new AccountError('Kata sandi harus berisi 15–128 karakter.');
  }
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  if (registration && (displayName.length < 2 || displayName.length > 60 || /[\x00-\x1f\x7f]/.test(displayName))) throw new AccountError('Nama harus berisi 2–60 karakter.');
  return { email, password: body.password, displayName };
}

/** @param {() => import('better-sqlite3').Database} getDatabase */
export function createAccountService(getDatabase, { now = Date.now } = {}) {
  let repository;
  const repo = () => repository ||= createAccountRepository(getDatabase());
  return {
    async register(body, previousToken) {
      const { email, password, displayName } = input(body, true);
      const passwordHash = await hashPassword(password);
      const token = randomBytes(32).toString('base64url');
      const time = now();
      try {
        const user = repo().register(email, displayName, passwordHash, digest(token), time, time + SESSION_AGE_MS, sessionHash(previousToken));
        return { user, token };
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new AccountError('Email sudah terdaftar. Silakan login.', 409);
        throw error;
      }
    },
    async login(body, previousToken) {
      const { email, password } = input(body, false);
      const row = repo().findEmail(email);
      const valid = await verifyPassword(password, row?.password_hash);
      if (!row || !valid) throw new AccountError('Email atau kata sandi tidak sesuai.', 401);
      const token = randomBytes(32).toString('base64url');
      const time = now();
      repo().login(row.id, digest(token), time, time + SESSION_AGE_MS, sessionHash(previousToken));
      return { user: publicAccount(row), token };
    },
    current(token) { const hash = sessionHash(token); return hash ? repo().current(hash, now()) : null; },
    logout(token) { const hash = sessionHash(token); if (hash) repo().logout(hash); },
  };
}
