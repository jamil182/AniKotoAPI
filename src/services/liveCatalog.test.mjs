import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAniKotoClient } from './anikotoApi.js';
import { createCatalogRouter } from '../routes/catalog.route.js';
import { getCatalogMode } from './catalogMode.js';

async function serve(t, router) {
  const app = express();
  app.use('/catalog', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/catalog`;
}

test('public catalog defaults to live and only accepts explicit supported modes', () => {
  for (const value of [undefined, '', ' ', 'live', ' LIVE ']) assert.equal(getCatalogMode(value), 'live');
  assert.equal(getCatalogMode('managed'), 'managed');
  assert.throws(() => getCatalogMode('automatic'), /PUBLIC_CATALOG_MODE/);
});

test('new upstream titles appear after cache refresh without admin import and keep Embed and Direct routes', async t => {
  let time = 0, latest = [];
  const client = createAniKotoClient({ now: () => time, request: async address => {
    const url = new URL(address);
    let results;
    if (url.pathname.endsWith('/top-ten')) results = { today: [], week: [], month: [] };
    else if (url.pathname.endsWith('/most-popular')) results = [];
    else if (url.pathname.endsWith('/episodes/primal-c9aa2')) results = { episodes: [{ episode_no: 1, server_ids: 'episode-token' }] };
    else if (url.pathname.endsWith('/servers')) results = [{ name: 'Vidstream-2', type: 'dub', link_id: 'primal-video-token' }];
    else if (url.pathname.endsWith('/stream')) results = { url: 'https://megaplay.buzz/stream/s-2/123/dub' };
    else if (url.pathname.endsWith('/info')) results = latest[0];
    else if (url.pathname.endsWith('/watch')) results = { title: 'Primal', episodeNumber: 1 };
    else results = { spotlights: [], trending: latest, topAiring: [], genres: [] };
    return { data: { success: true, results } };
  } });
  const base = await serve(t, createCatalogRouter(client, null, { resolve: async (source, id, slug) => {
    assert.equal(id, 'primal-video-token');
    assert.equal(slug, 'primal-c9aa2');
    assert.equal((await source.get('/stream', { id, slug })).url, 'https://megaplay.buzz/stream/s-2/123/dub');
    return { url: 'https://video.example/primal.m3u8', type: 'hls' };
  } }));
  assert.equal((await (await fetch(base + '/status')).json()).results.mode, 'live');
  assert.deepEqual((await (await fetch(base + '/home')).json()).results.latest, []);
  latest = [{ slug: 'primal-c9aa2', title: 'Primal' }];
  assert.deepEqual((await (await fetch(base + '/home')).json()).results.latest, [], 'short cache remains in effect');
  time = 30001;
  const home = await fetch(base + '/home');
  assert.equal(home.headers.get('cache-control'), 'no-store');
  assert.equal((await home.json()).results.latest[0].id, 'primal-c9aa2');
  for (const path of ['/anime/primal-c9aa2', '/episodes/primal-c9aa2', '/watch?slug=primal-c9aa2&ep=1']) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }
  const sources = (await (await fetch(base + '/embeds?slug=primal-c9aa2&ep=1')).json()).results.sources;
  assert.equal(sources[0].linkId, 'primal-video-token');
  const embed = await fetch(base + '/embed?slug=primal-c9aa2&id=primal-video-token');
  assert.equal((await embed.json()).results.url, 'https://megaplay.buzz/stream/s-2/123/dub');
  const direct = await fetch(base + '/resolve?slug=primal-c9aa2&id=primal-video-token');
  assert.equal((await direct.json()).results.type, 'hls');
});

test('live Direct MAL fallback derives its URL from the episode and validates language and episode', async t => {
  const client = { get: async () => ({ episodes: [{ episode_no: 1, mal_id: '20' }] }) };
  const base = await serve(t, createCatalogRouter(client, null, { resolve: async source => {
    const metadata = await source.get('/stream');
    assert.equal(metadata.url, 'https://megaplay.buzz/stream/mal/20/1/dub');
    return { url: 'https://video.example/episode.m3u8', type: 'hls' };
  } }));
  const direct = await fetch(base + '/resolve-stored?slug=primal-c9aa2&ep=1&language=dub&mal_id=9999');
  assert.equal(direct.status, 200);
  assert.equal((await direct.json()).results.type, 'hls');
  assert.equal((await fetch(base + '/resolve-stored?slug=primal-c9aa2&ep=1&language=en')).status, 400);
  assert.equal((await fetch(base + '/resolve-stored?slug=primal-c9aa2&ep=2&language=dub')).status, 404);
});

test('managed catalog status remains explicit', async t => {
  const base = await serve(t, createCatalogRouter({}, {}));
  assert.equal((await (await fetch(base + '/status')).json()).results.mode, 'managed');
});
