import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverRowsHTML } from './server-list.js';

test('server rows keep SUB before DUB and retain each source original index', () => {
  const html = serverRowsHTML([
    { name: 'DUB first', language: 'dub' },
    { name: 'HD-1', language: 'sub' },
    { name: 'Vidstream-2', language: 'sub' },
  ]);
  assert.ok(html.indexOf('data-language="sub"') < html.indexOf('data-language="dub"'));
  assert.match(html, /data-i="1"[^>]*>[\s\S]*?HD-1/);
  assert.match(html, /data-i="2"[^>]*>[\s\S]*?Vidstream-2/);
  assert.match(html, /data-i="0"[^>]*>[\s\S]*?DUB first/);
  assert.equal((html.match(/class="server-btn"/g) || []).length, 3);
});

test('missing languages are labeled without fabricated server buttons', () => {
  const html = serverRowsHTML([{ name: 'Vidstream-1', language: 'dub' }]);
  assert.match(html, /No SUB server available/);
  assert.equal((html.match(/class="server-btn"/g) || []).length, 1);
  assert.ok(!html.includes('HD-1'));
});

test('server names are escaped before rendering', () => {
  const html = serverRowsHTML([{ name: '<img src=x onerror=alert(1)>', language: 'sub' }]);
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img'));
});
