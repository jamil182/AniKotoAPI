import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { openDb, migrate } from '../db/db.js';
import { getAnimeById, getEpisodes, upsertAnime } from '../db/library.repo.js';
import { cmsAnime, updateCmsAnime } from '../db/cms.repo.js';
import { createCmsRouter } from '../routes/cms.route.js';
import { createCatalogRouter } from '../routes/catalog.route.js';
import { createPublishedCatalog } from './publishedCatalog.js';
import { importCatalogSeries, runCmsUpdates, syncCatalogSeries } from './cmsCatalog.js';
import { importMalEpisode } from './cmsMalImport.js';

function fixture() {
  const db = openDb(':memory:');
  const calls = [];
  let episodes = [{ episode_no: 1, title: 'First', server_ids: 'episode-token', mal_id: '20' }];
  const client = { get: async (path, params) => {
    calls.push({ path, params });
    if (path.startsWith('/episodes/')) return { episodes };
    if (path === '/info') return { animeId: 958, slug: 'naruto-eybxz', title: 'Naruto', poster: 'https://images.example/naruto.jpg', genres: ['Action'], malScore: '7.89' };
    if (path === '/servers') return [{ link_id: 'stream-token', name: 'HD-1', type: 'sub' }, { link_id: 'dub-token', name: 'HD-2', type: 'dub' }];
    if (path === '/stream') return { url: 'https://megaplay.buzz/stream/s-2/1/sub' };
    if (path === '/search') return { data: [{ slug: 'naruto-eybxz/ep-1', animeId: '958', title: 'Naruto' }] };
    if (path === '/schedule') return [{ slug: 'naruto-eybxz', title: 'Naruto' }, { slug: 'unpublished', title: 'Private' }];
    return {};
  } };
  return { db, client, calls, setEpisodes: value => { episodes = value; } };
}

test('managed menu categories filter published titles by type and exact airing status', async () => {
  const f = fixture();
  try {
    const result = await importCatalogSeries(f.db, f.client, { slug: 'naruto-eybxz' });
    updateCmsAnime(f.db, result.animeId, { publication_state: 'published', type: 'TV', status: 'Finished Airing' });
    const catalog = createPublishedCatalog(() => f.db, f.client);
    assert.equal(catalog.browse({ page: 1, source: 'completed', type: 'tv' }).data.length, 1);
    assert.equal(catalog.browse({ page: 1, source: 'ongoing' }).data.length, 0);
    assert.equal(catalog.browse({ page: 1, source: 'upcoming' }).data.length, 0);
    assert.equal(catalog.browse({ page: 1, source: 'latest', type: 'movie' }).data.length, 0);
  } finally { f.db.close(); }
});

test('migration preserves rows and defaults existing anime to Draft', () => {
  const db = openDb(':memory:');
  const id = upsertAnime(db, { title: 'Existing title' });
  migrate(db); migrate(db);
  assert.equal(getAnimeById(db, id).title, 'Existing title');
  assert.equal(getAnimeById(db, id).publication_state, 'draft');
  assert.throws(() => db.prepare("UPDATE anime SET publication_state = 'invalid' WHERE id = ?").run(id), /CHECK/);
  db.close();
});

test('import, edit, publish and sync retain editorial fields and stable source identity', async () => {
  const f = fixture();
  const imported = await importCatalogSeries(f.db, f.client, { slug: 'naruto-eybxz' });
  const id = imported.animeId;
  assert.equal(imported.anime.publication_state, 'draft');
  const catalog = createPublishedCatalog(() => f.db, f.client);
  assert.deepEqual(catalog.home().latest, []);
  assert.throws(() => catalog.anime('naruto-eybxz'), error => error.status === 404);
  updateCmsAnime(f.db, id, { title: 'Judul pilihan saya', synopsis: 'Sinopsis editorial', slug: 'naruto-pilihan', publication_state: 'published' });
  assert.equal(catalog.home().latest[0].title, 'Judul pilihan saya');
  assert.deepEqual(catalog.anime('naruto-pilihan').genres, ['Action']);
  f.setEpisodes([{ episode_no: 1, server_ids: 'refreshed-token', mal_id: '20' }, { episode_no: 2, server_ids: 'new-token', mal_id: '20' }]);
  const synced = await syncCatalogSeries(f.db, f.client, id);
  assert.equal(synced.added, 1);
  assert.equal(synced.anime.title, 'Judul pilihan saya');
  assert.equal(synced.anime.synopsis, 'Sinopsis editorial');
  assert.equal(synced.anime.publication_state, 'published');
  assert.equal(getEpisodes(f.db, id)[0].server_ids, 'refreshed-token');
  assert.equal(f.calls.at(-1).path, '/episodes/naruto-eybxz');
  await catalog.streamClient.get('/stream', { slug: 'naruto-pilihan', id: 'stream-token' });
  assert.equal(f.calls.at(-1).params.slug, 'naruto-eybxz');
  await importCatalogSeries(f.db, f.client, { slug: 'naruto-eybxz' });
  assert.equal(cmsAnime(f.db, id).title, 'Judul pilihan saya');
  assert.equal(cmsAnime(f.db, id).publication_state, 'published');
  updateCmsAnime(f.db, id, { publication_state: 'draft' });
  assert.deepEqual(catalog.search('Judul').data, []);
  assert.deepEqual(catalog.browse({ page: '1' }).data, []);
  assert.throws(() => catalog.episodes('naruto-pilihan'), error => error.status === 404);
  f.db.close();
});

test('publication validates episodes and languages and rejects unsupported SQL columns', () => {
  const { db } = fixture();
  const id = upsertAnime(db, { title: 'Empty draft' });
  assert.throws(() => updateCmsAnime(db, id, { publication_state: 'published' }), /minimal satu episode/);
  assert.throws(() => updateCmsAnime(db, id, { allow_sub: 0, allow_dub: 0 }), /minimal satu bahasa/);
  assert.throws(() => updateCmsAnime(db, id, { 'title = NULL --': 'bad' }), /tidak didukung/);
  db.close();
});

test('description adds source facts while preserving editorial metadata and publication access', async () => {
  const f = fixture();
  const result = await importCatalogSeries(f.db, f.client, { slug: 'naruto-eybxz' });
  updateCmsAnime(f.db, result.animeId, { title: 'Editorial title', synopsis: 'Editorial synopsis', publication_state: 'published' });
  const client = { get: async () => ({ title: 'Source title', synopsis: 'Source synopsis', aired: '2023-10-19', premiered: 'FALL 2023', producers: ['Producer'], altNames: 'Alternative title', malScore: '8.48' }) };
  const catalog = createPublishedCatalog(() => f.db, client);
  const data = await catalog.description('naruto-eybxz');
  assert.equal(data.title, 'Editorial title');
  assert.equal(data.synopsis, 'Editorial synopsis');
  assert.equal(data.aired, '2023-10-19');
  assert.deepEqual(data.producers, ['Producer']);
  const unavailable = createPublishedCatalog(() => f.db, { get: async () => { throw new Error('offline'); } });
  assert.equal((await unavailable.description('naruto-eybxz')).title, 'Editorial title');
  updateCmsAnime(f.db, result.animeId, { publication_state: 'draft' });
  await assert.rejects(catalog.description('naruto-eybxz'), error => error.status === 404);
  f.db.close();
});

test('import drops malformed image URLs from upstream metadata', async () => {
  const f = fixture();
  const client = { get: async (path, params) => {
    const data = await f.client.get(path, params);
    return path === '/info' ? { ...data, backgroundImage: "'", poster: 'javascript:alert(1)' } : data;
  } };
  const result = await importCatalogSeries(f.db, client, { slug: 'naruto-eybxz' });
  assert.equal(result.anime.banner, null);
  assert.equal(result.anime.poster, null);
  f.db.close();
});

test('MAL import preserves both languages when adding SUB and DUB together', async () => {
  const { db } = fixture();
  const result = await importMalEpisode(db, { source: 'mal', id: 20, episode: '1', sub: true, dub: true }, {
    resolve: async () => ({ url: 'https://cdn.example/master.m3u8', mediaId: 'test' }),
    metadata: async () => ({ title: 'Naruto', poster: 'https://images.example/naruto.jpg' }),
  });
  const episode = getEpisodes(db, result.animeId)[0];
  assert.deepEqual(JSON.parse(episode.embed_url), { sub: 'https://megaplay.buzz/stream/mal/20/1/sub', dub: 'https://megaplay.buzz/stream/mal/20/1/dub' });
  assert.equal(result.anime.publication_state, 'draft');
  updateCmsAnime(db, result.animeId, { publication_state: 'published' });
  const catalog = createPublishedCatalog(() => db, { get: async () => { assert.fail('stored episodes need no upstream lookup'); } });
  assert.equal(catalog.episodes(`library-${result.animeId}`).episodes[0].embed_url, episode.embed_url);
  db.close();
});

test('scheduled sync shares concurrent runs and does not publish Draft records', async () => {
  const f = fixture();
  const result = await importCatalogSeries(f.db, f.client, { slug: 'naruto-eybxz' });
  f.setEpisodes([{ episode_no: 1, server_ids: 'a' }, { episode_no: 2, server_ids: 'b' }]);
  const [a, b] = await Promise.all([runCmsUpdates(f.db, f.client), runCmsUpdates(f.db, f.client)]);
  assert.equal(a.added, 1);
  assert.deepEqual(a, b);
  assert.equal(cmsAnime(f.db, result.animeId).publication_state, 'draft');
  f.db.close();
});

test('HTTP admin authorization and Draft visibility hold across public routes', async t => {
  const f = fixture();
  const previousToken = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = 'cms-unit-test-token';
  t.after(() => { if (previousToken === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = previousToken; f.db.close(); });
  const app = express();
  app.use(express.json());
  app.use('/api/admin', createCmsRouter(() => f.db, f.client));
  app.use('/api/catalog', createCatalogRouter(f.client, createPublishedCatalog(() => f.db, f.client)));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'X-Admin-Token': 'cms-unit-test-token', 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '/api/admin/library')).status, 401);
  assert.equal((await fetch(base + '/api/admin/import', { method: 'POST', headers, body: JSON.stringify({ slug: '../bad' }) })).status, 400);
  const imported = await (await fetch(base + '/api/admin/import', { method: 'POST', headers, body: JSON.stringify({ slug: 'naruto-eybxz' }) })).json();
  const id = imported.results.animeId;
  for (const path of ['/anime/naruto-eybxz', '/episodes/naruto-eybxz', '/embeds?slug=naruto-eybxz&ep=1', '/embed?slug=naruto-eybxz&id=token', '/servers?slug=naruto-eybxz&ids=token', '/resolve?slug=naruto-eybxz&id=token', '/watch?slug=naruto-eybxz&ep=1']) {
    assert.equal((await fetch(base + '/api/catalog' + path)).status, 404, path);
  }
  assert.equal((await fetch(base + `/api/admin/anime/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ publication_state: 'invalid' }) })).status, 400);
  await fetch(base + `/api/admin/anime/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ publication_state: 'published' }) });
  const home = await (await fetch(base + '/api/catalog/home')).json();
  assert.equal(home.results.latest[0].id, 'naruto-eybxz');
  const embed = await (await fetch(base + '/api/catalog/embeds?slug=naruto-eybxz&ep=1')).json();
  assert.equal(embed.results.sources[0].name, 'HD-1');
  const search = await (await fetch(base + '/api/admin/search?keyword=naruto&page=2', { headers })).json();
  assert.equal(search.results.page, 2);
  assert.equal(search.results.data[0].slug, 'naruto-eybxz');
  await fetch(base + '/api/admin/sync-all', { method: 'POST', headers });
  const job = await (await fetch(base + '/api/admin/sync-status', { headers })).json();
  assert.equal(job.results.total, 1);
  assert.equal((await fetch(base + `/api/admin/anime/${id}`, { method: 'DELETE', headers })).status, 409);
  await fetch(base + `/api/admin/anime/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ publication_state: 'draft' }) });
  assert.equal((await fetch(base + '/api/catalog/anime/naruto-eybxz')).status, 404);
  assert.equal((await fetch(base + `/api/admin/anime/${id}`, { method: 'DELETE', headers })).status, 200);
});
