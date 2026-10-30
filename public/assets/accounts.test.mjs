import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnPath, accountRequest } from './accounts.js';

test('account redirects remain local and avoid returning to authentication pages', () => {
  for (const input of [null, '', '//evil.example', 'https://evil.example', '/\\evil.example', '/\r\nevil', '/login', '/register?next=/login', '/a/../login', '/api/auth/google/start', '/api/auth/logout']) {
    assert.equal(safeReturnPath(input), '/home', String(input));
  }
  assert.equal(safeReturnPath('/watch/primal-c9aa2/1?mode=direct'), '/watch/primal-c9aa2/1?mode=direct');
});

test('account requests use same-origin cookies and return useful errors', async t => {
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    sent = { url, ...options };
    return new Response(JSON.stringify({ success: true, results: { user: { id: 1 } } }), { status: 200 });
  });
  assert.equal((await accountRequest('login', { email: 'x@example.com', password: 'not-stored-client-side' })).user.id, 1);
  assert.equal(sent.url, '/api/auth/login');
  assert.equal(sent.credentials, 'same-origin');
  assert.equal(sent.method, 'POST');
  assert.equal(sent.cache, 'no-store');
  globalThis.fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ success: false, message: 'Email atau kata sandi tidak sesuai.' }), { status: 401 }));
  await assert.rejects(accountRequest('login', {}), /Email atau kata sandi/);
  globalThis.fetch.mock.mockImplementation(async () => new Response('not json', { status: 502 }));
  await assert.rejects(accountRequest('me'), /tidak dapat dihubungi/);
});
