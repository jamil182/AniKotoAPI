import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { openDb, migrate } from '../db/db.js';
import { createAccountService } from './accounts.js';
import { createAccountsRouter } from '../routes/accounts.route.js';

const identity = { subject: 'google-stable-subject', email: 'google@example.com', displayName: 'Google User' };
const password = 'a-long-local-passphrase-123';
async function fixture(t, { enabled = true, maxAttempts = 30, secure = false } = {}) {
  const db = openDb(':memory:'), app = express(), calls = [];
  let time = Date.now(), currentIdentity = identity;
  const configuration = { clientId: 'test.apps.googleusercontent.com', clientSecret: 'private-test-secret', redirectUri: (secure ? 'https:' : 'http:') + '//127.0.0.1/api/auth/google/callback' };
  const provider = {
    authorize(state, nonce, verifier) {
      calls.push({ state, nonce, verifier });
      return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ state, nonce });
    },
    async exchange(code, verifier, nonce) {
      const created = calls.find(call => call.verifier === verifier);
      assert.equal(created?.nonce, nonce); assert.equal(code, 'accepted-code');
      return currentIdentity;
    },
  };
  app.use(express.json());
  app.use('/api/auth', createAccountsRouter(() => db, { now: () => time, maxAttempts, google: { configuration: enabled ? configuration : null, provider: enabled ? provider : null } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  configuration.redirectUri = (secure ? base.replace('http:', 'https:') : base) + '/api/auth/google/callback';
  const get = (path, cookie, headers = {}) => fetch(base + '/api/auth/' + path, { redirect: 'manual', headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
  const post = (path, body, cookie, headers = {}) => fetch(base + '/api/auth/' + path, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: JSON.stringify(body) });
  const begin = async (cookie, next = '/watch/anime/2') => {
    const response = await get('google/start?' + new URLSearchParams({ next }), cookie);
    assert.equal(response.status, 303);
    const state = new URL(response.headers.get('location')).searchParams.get('state');
    const browser = response.headers.getSetCookie().find(value => value.includes('anijs_google_flow=')).split(';')[0];
    return { state, browser };
  };
  const complete = (flow, cookie = flow.browser, code = 'accepted-code') => get('google/callback?' + new URLSearchParams({ state: flow.state, code }), cookie);
  return { db, get, post, begin, complete, calls, advance: ms => { time += ms; }, setIdentity: value => { currentIdentity = value; } };
}
const session = response => response.headers.getSetCookie().find(value => value.startsWith('anijs_session=')).split(';')[0];

test('Google registration creates one passwordless account, hashed local session and stable subject identity across email changes', async t => {
  const f = await fixture(t), flow = await f.begin(null, '//attacker.example');
  const response = await f.complete(flow);
  assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/home');
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const cookie = session(response), first = (await (await f.get('me', cookie)).json()).results.user;
  assert.equal(first.email, identity.email);
  assert.equal(f.db.prepare('SELECT password_hash FROM user_accounts').get().password_hash, '!google-only');
  assert.notEqual(f.db.prepare('SELECT token_hash FROM user_sessions').get().token_hash, cookie.split('=')[1]);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM google_login_flows').get().n, 0);
  f.setIdentity({ ...identity, email: 'changed@example.com' });
  const newFlow = await f.begin(cookie), login = await f.complete(newFlow, cookie + '; ' + newFlow.browser);
  assert.equal((await (await f.get('me', session(login))).json()).results.user.id, first.id);
  assert.equal((await (await f.get('me', cookie)).json()).results.user, null);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM user_accounts').get().n, 1);
  const passwordLogin = await f.post('login', { email: identity.email, password });
  assert.equal(passwordLogin.status, 401);
});

test('Google callbacks reject missing browser binding, altered state, replay, expiration and cancelled consent', async t => {
  const f = await fixture(t), flow = await f.begin();
  assert.match((await f.complete(flow, '')).headers.get('location'), /google=expired/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM google_login_flows').get().n, 1);
  assert.match((await f.complete({ ...flow, state: 'a'.repeat(43) })).headers.get('location'), /google=expired/);
  assert.equal((await f.complete(flow)).headers.get('location'), '/watch/anime/2');
  assert.match((await f.complete(flow)).headers.get('location'), /google=expired/);
  const expired = await f.begin(); f.advance(600001);
  assert.match((await f.complete(expired)).headers.get('location'), /google=expired/);
  const denied = await f.begin();
  const response = await f.get('google/callback?' + new URLSearchParams({ state: denied.state, error: 'access_denied', error_description: '<script>unsafe</script>' }), denied.browser);
  assert.match(response.headers.get('location'), /google=cancelled/); assert.ok(!response.headers.get('location').includes('script'));
});

test('existing email never silently links; authenticated linking rotates the session and prevents another account claiming that identity', async t => {
  const f = await fixture(t), registration = await f.post('register', { displayName: 'Local User', email: identity.email, password });
  const cookie = session(registration), user = (await registration.json()).results.user;
  assert.match((await f.complete(await f.begin())).headers.get('location'), /google=existing_account/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM user_google_identities').get().n, 0);
  assert.equal((await f.post('google/link', {}, null)).status, 401);
  assert.equal((await f.post('google/link', {}, cookie, { Origin: 'https://attacker.example' })).status, 403);
  const linking = await f.post('google/link', {}, cookie), data = await linking.json();
  const state = new URL(data.results.url).searchParams.get('state'), browser = linking.headers.get('set-cookie').split(';')[0];
  const done = await f.complete({ state, browser }, cookie + '; ' + browser);
  assert.equal(done.headers.get('location'), '/account?google=linked');
  const linkedCookie = session(done);
  assert.equal((await (await f.get('me', linkedCookie)).json()).results.user.id, user.id);
  assert.equal((await (await f.get('google/status', linkedCookie)).json()).results.linked, true);
  assert.equal((await (await f.get('me', cookie)).json()).results.user, null);
  const other = await f.post('register', { displayName: 'Other User', email: 'other@example.com', password }), otherCookie = session(other);
  const attempt = await f.post('google/link', {}, otherCookie), attemptData = await attempt.json();
  const otherBrowser = attempt.headers.get('set-cookie').split(';')[0];
  const conflict = await f.complete({ state: new URL(attemptData.results.url).searchParams.get('state'), browser: otherBrowser }, otherCookie + '; ' + otherBrowser);
  assert.match(conflict.headers.get('location'), /google=identity_in_use/);
  assert.equal(f.db.prepare('SELECT user_id FROM user_google_identities').get().user_id, user.id);
});

test('a linking flow cannot finish after logout or while signed into a different local account', async t => {
  const f = await fixture(t), registration = await f.post('register', { email: 'local@example.com', displayName: 'Local', password });
  const cookie = session(registration), linking = await f.post('google/link', {}, cookie), data = await linking.json();
  const browser = linking.headers.get('set-cookie').split(';')[0], state = new URL(data.results.url).searchParams.get('state');
  await f.post('logout', {}, cookie);
  assert.match((await f.complete({ state, browser })).headers.get('location'), /google=expired/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM user_google_identities').get().n, 0);
});

test('disabled Google is explicit, flows are throttled and cross-site starts create no authorization state', async t => {
  const disabled = await fixture(t, { enabled: false });
  assert.deepEqual((await (await disabled.get('google/status')).json()).results, { enabled: false, linked: false });
  assert.match((await disabled.get('google/start')).headers.get('location'), /google=unavailable/);
  const limited = await fixture(t, { maxAttempts: 2 });
  assert.match((await limited.get('google/start', null, { 'Sec-Fetch-Site': 'cross-site' })).headers.get('location'), /google=failed/);
  assert.equal(limited.db.prepare('SELECT COUNT(*) AS n FROM google_login_flows').get().n, 0);
  await limited.begin();
  assert.equal((await limited.get('google/start')).status, 429);
});

test('Google migration is additive and idempotent for an existing password account', () => {
  const db = new Database(':memory:');
  try {
    db.exec("CREATE TABLE user_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL COLLATE NOCASE UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL); INSERT INTO user_accounts VALUES (7, 'existing@example.com', 'Existing', 'preserved-hash', 1000)");
    migrate(db); migrate(db);
    assert.equal(db.prepare('SELECT password_hash FROM user_accounts WHERE id = 7').get().password_hash, 'preserved-hash');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_google_identities').get().n, 0);
  } finally { db.close(); }
});

test('HTTPS deployments use a host-only secure flow cookie and a secure local session even behind an HTTP reverse proxy', async t => {
  const f = await fixture(t, { secure: true }), response = await f.get('google/start');
  const flowCookie = response.headers.get('set-cookie');
  assert.match(flowCookie, /^__Host-anijs_google_flow=/); assert.match(flowCookie, /; Secure/); assert.match(flowCookie, /HttpOnly/); assert.match(flowCookie, /SameSite=Lax/); assert.ok(!flowCookie.includes('Domain='));
  const done = await f.complete({ state: new URL(response.headers.get('location')).searchParams.get('state'), browser: flowCookie.split(';')[0] });
  assert.match(done.headers.getSetCookie().find(value => value.startsWith('anijs_session=')), /; Secure/);
});

test('failed token exchange consumes authorization state without creating an account or session', async t => {
  const f = await fixture(t), flow = await f.begin();
  const failed = await f.complete(flow, flow.browser, 'invalid-code');
  assert.match(failed.headers.get('location'), /google=verification_failed/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM user_accounts').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n, 0);
  assert.match((await f.complete(flow)).headers.get('location'), /google=expired/);
});
