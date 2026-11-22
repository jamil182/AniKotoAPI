import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createMiruroCatalog, miruroId, normalizeMiruroAnime } from './miruroCatalog.js';

const media = (id = 21) => ({ id, idMal: id, title: { english: 'One Piece', native: 'ワンピース' }, description: '<b>A pirate adventure.</b>', coverImage: { large: 'https://example.com/poster.jpg' }, format: 'TV', status: 'RELEASING', averageScore: 87, episodes: 100 });
const response = value => ({ data: { success: true, results: value } });
test('validates AniList identities and normalizes metadata without inventing released episode counts', () => {
  assert.equal(miruroId('al-21'), 21); assert.equal(miruroId('al-0'), null); assert.equal(miruroId('al-21/1'), null);
  const anime = normalizeMiruroAnime(media());
  assert.equal(anime.slug, 'al-21'); assert.equal(anime.rating, '8.7'); assert.equal(anime.synopsis, 'A pirate adventure.'); assert.equal(anime.sub, undefined);
  assert.equal(normalizeMiruroAnime({ id: 21, title: null }), null);
});
test('existing AniKoto slugs remain compatible while latest episodes use the Miruro release feed', async () => {
  const calls = [];
  const legacy = { get: async (...args) => { calls.push(args); return { episodes: [] }; } };
  const releases = { page: async params => ({ data: [{ title: 'Fresh release', language: params.language }], totalPages: 3 }) };
  const client = createMiruroCatalog({ legacy, releases, request: async () => { throw Error('unexpected Miruro request'); } });
  await client.get('/episodes/one-piece-odmau');
  assert.equal((await client.get('/latest-updated', { page: '2', language: 'dub' })).data[0].language, 'dub');
  assert.deepEqual(calls, [['/episodes/one-piece-odmau', {}]]);
});
test('deduplicates simultaneous metadata requests and serves stale metadata during an outage', async () => {
  let time = 0, calls = 0, broken = false;
  const client = createMiruroCatalog({ legacy: {}, now: () => time, request: async () => { calls++; if (broken) throw Error('offline'); return response(media()); } });
  const rows = await Promise.all([client.get('/info', { id: 'al-21' }), client.get('/info', { id: 'al-21' })]);
  assert.equal(calls, 1); assert.equal(rows[0].title, 'One Piece');
  time = 910000; broken = true; assert.equal((await client.get('/info', { id: 'al-21' })).slug, 'al-21'); assert.equal(calls, 2);
});

test('random selections bypass both memory and persisted caches while ordinary metadata stays cached', async () => {
  const db = new Database(':memory:');
  let randomCalls = 0, infoCalls = 0;
  try {
    db.exec('CREATE TABLE provider_metadata_cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires INTEGER NOT NULL, stale_until INTEGER NOT NULL, updated INTEGER NOT NULL)');
    db.prepare('INSERT INTO provider_metadata_cache VALUES (?,?,?,?,?)').run('/random?', JSON.stringify(media(99)), 100000, 1000000, 0);
    const client = createMiruroCatalog({ legacy: {}, getDatabase: () => db, now: () => 1000, request: async url => {
      if (url.includes('/random?')) return response(media(20 + ++randomCalls));
      infoCalls++; return response(media());
    } });
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await client.get('/random')).id);
    assert.deepEqual(ids, ['al-21', 'al-22', 'al-23']);
    await client.get('/info', { id: 'al-21' }); await client.get('/info', { id: 'al-21' });
    assert.equal(infoCalls, 1);
    assert.equal(db.prepare('SELECT payload FROM provider_metadata_cache WHERE key=?').get('/random?').payload, JSON.stringify(media(99)), 'random output is never written back to the shared cache');
  } finally { db.close(); }
});
test('blocked Miruro episodes fall back only after exact MAL confirmation, including search episode suffixes', async () => {
  const calls = [];
  const legacy = { get: async (endpoint, params) => {
    calls.push(endpoint);
    if (endpoint === '/search') return { data: [{ slug: 'wrong-movie/ep-1' }, { slug: 'one-piece-odmau/ep-1' }] };
    if (endpoint === '/episodes/wrong-movie') return { episodes: [{ episode_no: 1, mal_id: 999 }] };
    if (endpoint === '/episodes/one-piece-odmau') return { episodes: [{ episode_no: 1, mal_id: 21, server_ids: 'opaque' }] };
    if (endpoint === '/servers') return [{ name: 'HD-1', type: 'sub', link_id: 'verified-link' }];
    if (endpoint === '/stream') { assert.equal(params.slug, 'one-piece-odmau'); return { url: 'https://megaplay.buzz/stream/abc' }; }
    throw Error(endpoint);
  } };
  const request = async url => { if (url.includes('/episodes/')) throw Error('blocked'); return response(media()); };
  const client = createMiruroCatalog({ legacy, request });
  const result = await client.get('/episodes/al-21'); assert.equal(result.provider, 'anikoto-fallback'); assert.equal(result.legacySlug, 'one-piece-odmau');
  await assert.rejects(client.get('/stream', { slug: 'al-21', id: 'unissued-link' }), /not found/);
  await client.get('/servers', { slug: 'al-21', ids: 'opaque' });
  const stream = await client.get('/stream', { slug: 'al-21', id: 'verified-link' }); assert.match(stream.url, /megaplay/);
  await assert.rejects(client.get('/stream', { slug: 'al-22', id: 'verified-link' }), /not found/);
  assert.ok(calls.includes('/episodes/wrong-movie'));
});
test('does not fabricate episodes when both streaming sources are missing or MAL identity differs', async () => {
  const legacy = { get: async endpoint => endpoint === '/search' ? { data: [{ slug: 'wrong-show' }] } : { episodes: [{ episode_no: 1, mal_id: 900 }] } };
  const client = createMiruroCatalog({ legacy, request: async url => { if (url.includes('/episodes/')) throw Error('offline'); return response(media()); } });
  assert.deepEqual((await client.get('/episodes/al-21')).episodes, []);
  await assert.rejects(client.embeds('al-21', '1'), /not available/);
});
test('normalizes Miruro provider episodes and rejects a cross-show direct stream token', async () => {
  const client = createMiruroCatalog({ legacy: {}, request: async url => {
    if (url.includes('/episodes/')) return response({ providers: { sun: { episodes: { sub: [{ number: 1, title: 'Episode One', id: 'watch/sun/21/sub/abc-1' }], dub: [] } } } });
    if (url.includes('/watch/')) return response({ streams: [{ url: 'https://cdn.example.com/video.m3u8', type: 'hls' }], subtitles: [{ url: '/api/proxy?url=https%3A%2F%2Fcdn.example.com%2Fsub.vtt', language: 'en' }] });
    return response(media());
  } });
  const eps = await client.get('/episodes/al-21'); assert.equal(eps.episodes[0].server_ids, 'mr-21-1');
  const servers = await client.get('/servers', { slug: 'al-21', ids: 'mr-21-1' }); assert.equal(servers[0].link_id, 'watch/sun/21/sub/abc-1');
  const stream = await client.resolve(servers[0].link_id, 'al-21'); assert.equal(stream.subtitles[0].url, 'https://cdn.example.com/sub.vtt');
  await assert.rejects(client.resolve('watch/sun/22/sub/abc-1', 'al-21'), /not found/);
  const embeds = await client.embeds('al-21', '1'); assert.equal(embeds.sources.length, 2); assert.ok(embeds.sources.every(source => source.language === 'sub'));
});
test('rejects invalid private-service ports', () => {
  for (const port of [4444, 4455, 80, 65536, NaN]) assert.throws(() => createMiruroCatalog({ legacy: {}, port }), /Invalid Miruro port/);
});
test('discovery normalizes anime and people without turning untrusted profile links into navigation',async()=>{
  const client=createMiruroCatalog({legacy:{},request:async url=>{
    const kind=new URL(url).searchParams.get('kind');
    return response({page:1,total:60,perPage:28,hasNextPage:true,results:kind==='anime'?[media()]:[{id:77,name:{full:'Test Person'},image:{large:'https://example.com/p.jpg'},siteUrl:'javascript:bad()'}]});
  }});
  const anime=await client.discover({kind:'anime',page:'1',sort:'POPULARITY_DESC'});assert.equal(anime.data[0].slug,'al-21');assert.equal(anime.totalPages,3);
  const people=await client.discover({kind:'characters',page:'1',sort:'POPULARITY_DESC'});assert.equal(people.data[0].href,'https://anilist.co/character/77/');
});
test('persists verified legacy identities across restarts so existing comment threads remain addressable', async () => {
  const db = new Database(':memory:');
  try {
    const legacy = { get: async endpoint => endpoint === '/search' ? { data: [{ slug: 'one-piece-odmau/ep-1' }] } : { episodes: [{ episode_no: 1, mal_id: 21 }] } };
    const first = createMiruroCatalog({ legacy, getDatabase: () => db, request: async () => response(media()) });
    assert.equal(await first.canonicalSlug('al-21'), 'one-piece-odmau');
    const restarted = createMiruroCatalog({ legacy: {}, getDatabase: () => db, request: async () => { throw Error('identity should not need network after restart'); } });
    assert.equal(await restarted.canonicalSlug('al-21'), 'one-piece-odmau'); assert.equal(await restarted.canonicalSlug('original-slug'), 'original-slug');
  } finally { db.close(); }
});
test('metadata survives process restarts and provider throttling without losing the catalog', async () => {
  const db = new Database(':memory:'); let time = 1000;
  try {
    const first = createMiruroCatalog({legacy:{},getDatabase:()=>db,now:()=>time,request:async()=>response(media())});
    await first.get('/info',{id:'al-21'}); time = 1000000;
    let calls = 0;
    const next = createMiruroCatalog({legacy:{},getDatabase:()=>db,now:()=>time,request:async()=>{calls++; throw {response:{status:429}};}});
    assert.equal((await next.get('/info',{id:'al-21'})).title,'One Piece');
    await assert.rejects(next.get('/info',{id:'al-22'}),/busy/); assert.equal(calls,1);
  } finally {db.close();}
});
