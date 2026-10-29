import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { createBrandingRouter } from './branding.route.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'anijs-branding-'));
  await writeFile(path.join(directory, 'logo.png'), 'original logo');
  await writeFile(path.join(directory, 'favicon.png'), 'original icon');
  const app = express();
  app.use('/api/branding', createBrandingRouter(directory));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, get: () => fetch(`http://127.0.0.1:${server.address().port}/api/branding`) };
}

test('branding metadata is not cached and versions reflect actual file contents', async t => {
  const { get } = await fixture(t);
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
  const first = (await response.json()).results;
  assert.match(first.logo, /^\/logo\.png\?v=[a-f0-9]{24}$/);
  assert.match(first.favicon, /^\/favicon\.png\?v=[a-f0-9]{24}$/);
  assert.deepEqual((await (await get()).json()).results, first);
});

test('replacing same-size artwork updates its URL without restarting the application', async t => {
  const { directory, get } = await fixture(t);
  const first = (await (await get()).json()).results;
  const filename = path.join(directory, 'logo.png');
  const original = await stat(filename);
  await writeFile(filename, 'replaced logo');
  await utimes(filename, original.atime, new Date(original.mtimeMs + 5000));
  const next = (await (await get()).json()).results;
  assert.notEqual(next.logo, first.logo);
  assert.equal(next.favicon, first.favicon);
  await writeFile(filename, 'original logo');
  await utimes(filename, original.atime, new Date(original.mtimeMs + 10000));
  assert.equal((await (await get()).json()).results.logo, first.logo);
});

test('missing or empty branding assets fail safely and recover after replacement', async t => {
  const { directory, get } = await fixture(t);
  await rm(path.join(directory, 'logo.png'));
  const missing = await get();
  assert.equal(missing.status, 503);
  assert.ok(!JSON.stringify(await missing.json()).includes(directory));
  await writeFile(path.join(directory, 'logo.png'), '');
  assert.equal((await get()).status, 503);
  await writeFile(path.join(directory, 'logo.png'), 'new logo');
  assert.equal((await get()).status, 200);
});
