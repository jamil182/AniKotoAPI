import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { openDb } from '../db/db.js';
import { createAccountsRouter } from '../routes/accounts.route.js';
import { createAccountService, SESSION_AGE_MS } from './accounts.js';
import { adminAuth } from '../middleware/adminAuth.js';

const password = 'a-long-test-passphrase-26';
async function fixture(t, options = {}) {
  const { trustProxy = false, ...accountOptions } = options;
  const db = openDb(':memory:');
  const app = express();
  app.set('trust proxy', trustProxy);
  app.use(express.json());
  app.use('/auth', createAccountsRouter(() => db, accountOptions));
  app.get('/admin', adminAuth, (req, res) => res.json({ ok: true }));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ success: false }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(base + '/auth/' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { db, base, post };
}

test('registration persists a salted password and opaque hashed session; rotation and logout revoke cookies', async t => {
  const { db, base, post } = await fixture(t);
  const registration = await post('register', { email: ' USER@Example.com ', displayName: 'Pengguna Uji', password });
  assert.equal(registration.status, 201);
  const firstCookie = registration.headers.get('set-cookie');
  assert.match(firstCookie, /HttpOnly/);
  assert.match(firstCookie, /SameSite=Lax/);
  assert.match(firstCookie, /Max-Age=604800/);
  const cookie = firstCookie.split(';')[0];
  const payload = await registration.json();
  assert.deepEqual(Object.keys(payload.results.user).sort(), ['createdAt', 'displayName', 'email', 'id']);
  assert.equal(payload.results.user.email, 'user@example.com');
  const row = db.prepare('SELECT * FROM user_accounts').get();
  assert.match(row.password_hash, /^scrypt-v1\$/);
  assert.ok(!row.password_hash.includes(password));
  assert.notEqual(db.prepare('SELECT token_hash FROM user_sessions').get().token_hash, cookie.split('=')[1]);
  assert.equal((await (await fetch(base + '/auth/me', { headers: { Cookie: cookie } })).json()).results.user.id, row.id);
  const duplicate = await post('register', { email: 'USER@example.com', displayName: 'Second', password });
  assert.equal(duplicate.status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_accounts').get().n, 1);
  const unknown = await post('login', { email: 'unknown@example.com', password });
  const incorrect = await post('login', { email: row.email, password: 'another-wrong-password' });
  assert.equal(unknown.status, 401);
  assert.equal(incorrect.status, 401);
  assert.equal((await unknown.json()).message, (await incorrect.json()).message);
  const login = await post('login', { email: row.email, password }, { Cookie: cookie, 'X-Forwarded-Proto': 'https' });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /Secure/);
  const rotated = login.headers.get('set-cookie').split(';')[0];
  assert.notEqual(rotated, cookie);
  assert.equal((await (await fetch(base + '/auth/me', { headers: { Cookie: cookie } })).json()).results.user, null);
  const previous = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = 'admin-only-token';
  try { assert.equal((await fetch(base + '/admin', { headers: { Cookie: rotated } })).status, 401); }
  finally { if (previous === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = previous; }
  const logout = await post('logout', {}, { Cookie: rotated });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await (await fetch(base + '/auth/me', { headers: { Cookie: rotated } })).json()).results.user, null);
});

test('account validation and CSRF protection reject malformed, cross-site and form requests', async t => {
  const { base, post } = await fixture(t);
  for (const body of [null, [], { email: 'bad', password }, { email: 'x@example.com', password: 'short' },
    { email: 'x@example.com', password, displayName: 'x' },
    { email: 'x@example.com', password, displayName: 'User', role: 'admin' }]) {
    assert.equal((await post('register', body)).status, 400);
  }
  assert.equal((await post('login', {}, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post('logout', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post('logout', {}, { Origin: 'null' })).status, 403);
  assert.equal((await fetch(base + '/auth/login', { method: 'POST', body: 'email=x@example.com' })).status, 415);
  const result = await fetch(base + '/auth/me', { headers: { Cookie: 'anijs_session=not-a-token' } });
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).results.user, null);
});

test('authentication throttle expires and supplies Retry-After', async t => {
  let time = 0;
  const { post } = await fixture(t, { now: () => time, maxAttempts: 2 });
  assert.equal((await post('login', {})).status, 400);
  assert.equal((await post('login', {})).status, 400);
  const limited = await post('login', {});
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '900');
  time = 900001;
  assert.equal((await post('login', {})).status, 400);
});

test('local reverse proxy preserves visitor throttles and rejects forged address chains', async t => {
  const { post } = await fixture(t, { trustProxy: 'loopback', maxAttempts: 1 });
  assert.equal((await post('login', {}, { 'X-Forwarded-For': '203.0.113.9, 198.51.100.1' })).status, 400);
  assert.equal((await post('login', {}, { 'X-Forwarded-For': '203.0.113.10, 198.51.100.1' })).status, 429);
  assert.equal((await post('login', {}, { 'X-Forwarded-For': '198.51.100.2' })).status, 400);
});

test('untrusted direct requests cannot evade throttling with forwarded headers', async t => {
  const { post } = await fixture(t, { maxAttempts: 1 });
  assert.equal((await post('login', {}, { 'X-Forwarded-For': '198.51.100.1' })).status, 400);
  assert.equal((await post('login', {}, { 'X-Forwarded-For': '198.51.100.2' })).status, 429);
});

test('sessions expire and each account retains at most five active sessions', async t => {
  const db = openDb(':memory:');
  t.after(() => db.close());
  let time = 1000;
  const service = createAccountService(() => db, { now: () => time });
  const first = await service.register({ email: 'expire@example.com', displayName: 'User', password });
  for (let i = 0; i < 5; i++) await service.login({ email: first.user.email, password });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n, 5);
  assert.equal(service.current(first.token), null);
  const last = await service.login({ email: first.user.email, password });
  assert.equal(service.current(last.token).email, first.user.email);
  time += SESSION_AGE_MS;
  assert.equal(service.current(last.token), null);
});
