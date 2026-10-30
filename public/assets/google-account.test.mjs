import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleErrorMessage, googleAccountStatus, linkGoogleAccount } from './google-account.js';

test('Google errors use known messages instead of reflecting query strings or inherited object properties', () => {
  for (const value of ['<script>alert(1)</script>', '__proto__', 'constructor', null, ['expired']]) assert.equal(googleErrorMessage(value), '');
  assert.match(googleErrorMessage('existing_account'), /kata sandi/);
  assert.match(googleErrorMessage('expired'), /berakhir/);
});
test('Google status is fetched privately and malformed responses are not treated as disabled accounts', async t => {
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    sent = { url, ...options };
    return Response.json({ success: true, results: { enabled: true, linked: false } });
  });
  assert.deepEqual(await googleAccountStatus(), { enabled: true, linked: false });
  assert.equal(sent.url, '/api/auth/google/status'); assert.equal(sent.credentials, 'same-origin'); assert.equal(sent.cache, 'no-store');
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ success: true, results: { enabled: 'true', linked: false } }));
  await assert.rejects(googleAccountStatus(), /tidak valid/);
});
test('Google linking uses a same-origin JSON POST and only accepts the exact Google authorization origin and path', async t => {
  let sent, target = 'https://accounts.google.com/o/oauth2/v2/auth?state=test';
  t.mock.method(globalThis, 'fetch', async (url, options) => { sent = { url, ...options }; return Response.json({ success: true, results: { url: target } }); });
  assert.equal(await linkGoogleAccount(), target);
  assert.equal(sent.method, 'POST'); assert.equal(sent.credentials, 'same-origin'); assert.equal(sent.body, '{}');
  for (const invalid of ['javascript:alert(1)', 'http://accounts.google.com/o/oauth2/v2/auth', 'https://accounts.google.com.attacker.example/o/oauth2/v2/auth', 'https://accounts.google.com/evil', 'https://user:secret@accounts.google.com/o/oauth2/v2/auth', null]) {
    target = invalid; await assert.rejects(linkGoogleAccount(), /tidak valid/);
  }
});
