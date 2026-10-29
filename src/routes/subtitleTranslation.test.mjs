import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { migrate } from '../db/db.js';
import { createSubtitleTranslationRouter } from './subtitleTranslation.route.js';

const source = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n';
async function fixture(t, options) {
  const db = new Database(':memory:'); migrate(db);
  const app = express(); app.use('/translate', createSubtitleTranslationRouter(() => db, { load: async () => source, provider: 'test', ...options }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}/translate`;
  return { db, get: (file = 'a', params = '') => fetch(`${base}?url=${encodeURIComponent('https://megaplay.buzz/' + file + '.vtt')}&to=id${params}`), base };
}
const complete = text => ({ vtt: text.replace('Hello', 'Halo'), provider: 'test', translated: 1, failed: 0 });

test('translation returns progress immediately, deduplicates viewers and serves the persisted complete track', async t => {
  let release, calls = 0;
  const wait = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { translate: async (text, to, options) => { calls++; options.onProgress(0, 1); await wait; options.onProgress(1, 1); return complete(text); } });
  const first = await f.get(); assert.equal(first.status, 202);
  assert.deepEqual((await first.json()).results, { status: 'translating', completed: 0, total: 0 });
  const pending = await f.get(); assert.equal(pending.status, 202);
  assert.equal((await pending.json()).results.total, 1); assert.equal(calls, 1);
  release(); await new Promise(resolve => setImmediate(resolve));
  const ready = await f.get(); assert.equal(ready.status, 200);
  assert.equal(ready.headers.get('x-translation-cache'), 'hit');
  assert.equal(await ready.text(), source.replace('Hello', 'Halo'));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM subtitle_translation').get().n, 1);
  assert.equal(calls, 1);
});
test('invalid query destinations and subtitle documents cannot consume provider quota', async t => {
  let calls = 0;
  const f = await fixture(t, { load: async () => '<html>CDN error</html>', translate: async () => { calls++; return complete(source); } });
  assert.equal((await fetch(f.base + '?url=http://127.0.0.1/private&to=id')).status, 403);
  assert.equal((await f.get('a', '&from[]=en')).status, 400);
  assert.equal((await f.get()).status, 202);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.get()).status, 503); assert.equal(calls, 0);
});
test('quota failures are explicit and never cached as VTT or exposed as raw provider errors', async t => {
  const f = await fixture(t, { translate: async () => { throw Object.assign(new Error('secret upstream credentials'), { quota: true }); } });
  await f.get(); await new Promise(resolve => setImmediate(resolve));
  const response = await f.get(); assert.equal(response.status, 429);
  const text = await response.text(); assert.match(text, /Kuota/); assert.ok(!text.includes('secret'));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM subtitle_translation').get().n, 0);
});
test('partial translations are not cached and busy workers return Retry-After', async t => {
  const partial = await fixture(t, { translate: async () => ({ ...complete(source), failed: 1 }) });
  await partial.get(); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await partial.get()).status, 503);
  assert.equal(partial.db.prepare('SELECT COUNT(*) AS n FROM subtitle_translation').get().n, 0);
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { translate: async text => { await wait; return complete(text); } });
  await f.get('one'); await f.get('two');
  const busy = await f.get('three'); assert.equal(busy.status, 503); assert.equal(busy.headers.get('retry-after'), '15');
  release(); await new Promise(resolve => setImmediate(resolve));
});
