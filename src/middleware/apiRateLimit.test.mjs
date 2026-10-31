import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApiRateLimit } from './apiRateLimit.js';
import { internalApiHeaders } from '../services/internalApi.js';
import { createAniKotoClient } from '../services/anikotoApi.js';

async function fixture(t, options = {}) {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(createApiRateLimit(options));
  app.use((req, res) => res.json({ success: true, results: { path: req.path } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return (path, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers });
}

test('rapid episode 80–90 transitions do not consume Home or native allowance', async t => {
  const get = await fixture(t, { limit: 2, playbackLimit: 55 });
  for (let episode = 80; episode <= 90; episode++) {
    for (const path of ['anime/one-piece', 'episodes/one-piece', 'watch', 'embeds', 'resolve']) {
      assert.equal((await get(`/api/catalog/${path}?ep=${episode}`)).status, 200);
    }
  }
  const blocked = await get('/api/catalog/watch?ep=91');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('x-ratelimit-bucket'), 'playback');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal(blocked.headers.get('cache-control'), 'no-store');
  assert.equal((await get('/api/catalog/home')).status, 200);
  assert.equal((await get('/api/latest-updated')).status, 200);
});

test('authenticated internal native calls do not exhaust public or other visitors budgets', async t => {
  const get = await fixture(t, { limit: 1 });
  const headers = internalApiHeaders(new URL('https://aniyear.com/api/'), 'https://aniyear.com');
  for (let index = 0; index < 6; index++) assert.equal((await get('/api/watch', headers)).status, 200);
  assert.equal((await get('/api/watch', { 'x-anijs-internal-api': 'forged' })).status, 200);
  assert.equal((await get('/api/watch', { 'x-anijs-internal-api': 'é'.repeat(64) })).status, 429);
  assert.equal((await get('/api/watch', { 'x-forwarded-for': '203.0.113.11' })).status, 200);
  assert.equal((await get('/api/auth/me', headers)).status, 200);
  assert.equal((await get('/api/auth/me', headers)).status, 429, 'internal markers never bypass account limits');
});

test('video segments and health remain available when limited; prefix lookalikes stay limited', async t => {
  const get = await fixture(t, { limit: 1 });
  await get('/api/stream/proxy-invalid');
  assert.equal((await get('/api/stream/proxy-invalid')).status, 429);
  for (const path of ['/api/stream/proxy', '/api/stream/ts-proxy/', '/api/stream/sub-proxy', '/api/health', '/home']) {
    assert.equal((await get(path)).status, 200);
    assert.equal((await get(path)).status, 200);
  }
});

test('rolling window resets, invalid settings fall back and storage stays bounded', async t => {
  let time = 0;
  const get = await fixture(t, { limit: 1, windowMs: 1000, maxBuckets: 1, now: () => time });
  await get('/api/catalog/home');
  assert.equal((await get('/api/catalog/home')).status, 429);
  assert.equal((await get('/api/catalog/home', { 'x-forwarded-for': '203.0.113.12' })).status, 429);
  time = 1000;
  assert.equal((await get('/api/catalog/home', { 'x-forwarded-for': '203.0.113.12' })).status, 200);
  const defaults = await fixture(t, { limit: -1, playbackLimit: 'invalid', windowMs: 0 });
  const response = await defaults('/api/catalog/home');
  assert.equal(response.headers.get('x-ratelimit-limit'), '100');
  assert.equal((await defaults('/api/catalog/watch')).headers.get('x-ratelimit-limit'), '300');
});

test('internal marker is scoped to the configured HTTPS site native API and never external providers', async t => {
  for (const base of ['https://external.example/api/', 'https://aniyear.com/api/catalog/', 'http://aniyear.com/api/']) {
    assert.deepEqual(internalApiHeaders(new URL(base), 'https://aniyear.com'), {});
  }
  assert.deepEqual(internalApiHeaders(new URL('https://aniyear.com/api/'), ''), {});
  const original = process.env.SITE_URL;
  process.env.SITE_URL = 'https://aniyear.com';
  t.after(() => { if (original === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = original; });
  let marker;
  for (const [baseUrl, expected] of [['https://aniyear.com/api', true], ['https://external.example/api', false]]) {
    const client = createAniKotoClient({ baseUrl, request: async (url, config) => {
      marker = config.headers['x-anijs-internal-api'];
      return { data: { success: true, results: [] } };
    } });
    await client.get('/watch');
    assert.equal(typeof marker === 'string', expected);
  }
});
