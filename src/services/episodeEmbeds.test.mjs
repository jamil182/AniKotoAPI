import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEpisodeEmbeds } from './episodeEmbeds.js';
import { malEmbedSources, parseEmbedUrl } from '../../public/assets/embed-policy.js';

test('embed URLs only allow HTTPS player origins and streaming paths', () => {
  for (const url of [
    'javascript:alert(1)', 'http://megaplay.buzz/stream/mal/20/1/sub',
    'https://megaplay.buzz.evil.example/stream/mal/20/1/sub',
    'https://user:password@megaplay.buzz/stream/mal/20/1/sub',
    'https://megaplay.buzz:444/stream/mal/20/1/sub',
    'https://megaplay.buzz/admin', 'https://localhost/stream/test', null,
  ]) assert.equal(parseEmbedUrl(url), null);
  assert.equal(parseEmbedUrl('https://megaplay.buzz/stream/mal/24835/1/sub').hostname, 'megaplay.buzz');
  assert.equal(parseEmbedUrl('https://megaplay.buzz/videojs/stream/s-2/766094/sub').pathname, '/videojs/stream/s-2/766094/sub');
});

test('MAL embed URLs validate IDs and keep decimal episode numbers', () => {
  assert.deepEqual(malEmbedSources('24835', '1.5').map(source => source.url), [
    'https://megaplay.buzz/stream/mal/24835/1.5/sub',
    'https://megaplay.buzz/stream/mal/24835/1.5/dub',
  ]);
  for (const [id, ep] of [[0, 1], ['20/evil', 1], [20, -1], [20, 'NaN'], [20, '../2']]) {
    assert.deepEqual(malEmbedSources(id, ep), []);
  }
});

test('episode without server tokens uses its own MAL ID without stream resolution', async () => {
  const calls = [];
  const client = { get: async path => {
    calls.push(path);
    return { episodes: [{ episode_no: 1, mal_id: '24835' }, { episode_no: 3, mal_id: '20' }] };
  } };
  const data = await getEpisodeEmbeds(client, 'mobile-suit-gundam-san-6778b', '1');
  assert.equal(data.sources[0].url, 'https://megaplay.buzz/stream/mal/24835/1/sub');
  assert.deepEqual(calls, ['/episodes/mobile-suit-gundam-san-6778b']);
  await assert.rejects(getEpisodeEmbeds(client, 'mobile-suit-gundam-san-6778b', '2'), error => error.status === 404);
});

test('real server names take priority over MAL links and retain each provider token', async () => {
  const calls = [];
  const servers = [
    { link_id: 'hd1', sv_id: '323', name: 'HD-1', type: 'dub' },
    { link_id: 'vs2', sv_id: 'e54', name: 'Vidstream-2', type: 'dub' },
    { link_id: 'vs1', sv_id: '1a7', name: 'Vidstream-1', type: 'dub' },
    { link_id: 'hd2', sv_id: '323', name: 'HD-2', type: 'dub' },
  ];
  const client = { get: async (path, params) => {
    calls.push({ path, params });
    return path.startsWith('/episodes/')
      ? { episodes: [{ episode_no: 1, mal_id: '24835', server_ids: 'episode-token' }] }
      : servers;
  } };
  const { sources } = await getEpisodeEmbeds(client, 'test-anime', '1');
  assert.deepEqual(sources.map(source => `${source.name} · ${source.language.toUpperCase()}`), [
    'HD-1 · DUB', 'Vidstream-2 · DUB', 'Vidstream-1 · DUB', 'HD-2 · DUB',
  ]);
  assert.deepEqual(sources.map(source => source.linkId), ['hd1', 'vs2', 'vs1', 'hd2']);
  assert.ok(sources.every(source => source.url === undefined));
  assert.deepEqual(calls[1], { path: '/servers', params: { ids: 'episode-token', slug: 'test-anime' } });
  assert.equal(calls.length, 2, 'embed URL lookup is deferred until a server is selected');
});

test('server list keeps only available languages and removes duplicate link entries', async () => {
  const client = { get: async path => path.startsWith('/episodes/')
    ? { episodes: [{ episode_no: 1, server_ids: 'token' }] }
    : [
      { link_id: 'a', name: 'HD-1', type: 'sub' },
      { link_id: 'a', name: 'HD-1', type: 'sub' },
      { link_id: 'b', name: 'HD-2', type: 'sub' },
      { link_id: '', type: 'dub' },
      { link_id: 'invalid-language', type: 'unexpected' },
      null,
    ] };
  const { sources } = await getEpisodeEmbeds(client, 'test', '1');
  assert.deepEqual(sources.map(source => source.name), ['HD-1', 'HD-2']);
  assert.ok(sources.every(source => source.language === 'sub'));
});

test('MAL fallback remains available when the server API fails or returns no valid servers', async () => {
  for (const mode of ['error', 'empty', 'invalid']) {
    const client = { get: async path => {
      if (path.startsWith('/episodes/')) return { episodes: [{ episode_no: 1, mal_id: '20', server_ids: 'token' }] };
      if (mode === 'error') throw new Error('upstream unavailable');
      return mode === 'empty' ? [] : { malformed: true };
    } };
    const { sources } = await getEpisodeEmbeds(client, 'test', '1');
    assert.equal(sources[0].url, 'https://megaplay.buzz/stream/mal/20/1/sub');
  }
});

test('missing streams fail explicitly when no MAL fallback is available', async () => {
  const client = { get: async path => path.startsWith('/episodes/')
    ? { episodes: [{ episode_no: 1, server_ids: 'token' }] } : [] };
  await assert.rejects(getEpisodeEmbeds(client, 'test', '1'), error => error.status === 404);
});

test('episodes without MAL IDs use upstream embed server tokens', async () => {
  const client = { get: async path => path.startsWith('/episodes/')
    ? { episodes: [{ episode_no: 1, server_ids: 'episode-token' }] }
    : [{ link_id: 'sub-token', type: 'sub', name: 'HD-1' }, { link_id: 'dub-token', type: 'dub' }, null] };
  const data = await getEpisodeEmbeds(client, 'test-anime', '1');
  assert.deepEqual(data.sources.map(source => source.linkId), ['sub-token', 'dub-token']);
  assert.equal(data.sources[1].language, 'dub');
  await assert.rejects(getEpisodeEmbeds({ get: async () => ({ episodes: 'bad data' }) }, 'test', '1'), /Invalid episode/);
});
