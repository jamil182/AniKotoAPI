import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AccountError } from './accountError.js';

const derive = promisify(scrypt);
const options = Object.freeze({ N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
const dummy = `scrypt-v1$${Buffer.alloc(16).toString('base64url')}$${Buffer.alloc(64).toString('base64url')}`;
let active = 0;
/** @type {Array<() => void>} */
const waiting = [];

// Bound both memory-intensive workers and the queue before starting scrypt.
/** @template T @param {() => Promise<T>} work @returns {Promise<T>} */
async function passwordWork(work) {
  if (active >= 2) {
    if (waiting.length >= 8) throw new AccountError('Layanan sedang sibuk. Coba beberapa saat lagi.', 503);
    await new Promise(resolve => waiting.push(resolve));
  } else active++;
  try { return await work(); }
  finally {
    const next = waiting.shift();
    if (next) next(); else active--;
  }
}

/** @param {string} password @returns {Promise<string>} */
export function hashPassword(password) {
  return passwordWork(async () => {
    const salt = randomBytes(16);
    const digest = await derive(password, salt, 64, options);
    return `scrypt-v1$${salt.toString('base64url')}$${digest.toString('base64url')}`;
  });
}

/** @param {string} password @param {string | undefined} stored @returns {Promise<boolean>} */
export function verifyPassword(password, stored) {
  const valid = typeof stored === 'string' && /^scrypt-v1\$[\w-]{22}\$[\w-]{86}$/.test(stored);
  const [, salt, digest] = (valid ? stored : dummy).split('$');
  return passwordWork(async () => {
    const actual = await derive(password, Buffer.from(salt, 'base64url'), 64, options);
    const matches = timingSafeEqual(actual, Buffer.from(digest, 'base64url'));
    return valid && matches;
  });
}
