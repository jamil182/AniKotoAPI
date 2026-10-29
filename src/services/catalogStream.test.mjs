import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCatalogStream } from './catalogStream.js';
import { assertProxyableUrl } from '../helper/streamProxy.helper.js';

test('resolves the upstream embed locally and authorizes its rotating media and subtitle CDNs', async () => {
  const calls = [];
  const client = { get: async (path, params) => {
    calls.push({ path, params });
    return { url: 'https://megaplay.buzz/videojs/stream/s-2/766094/sub', skipData: { intro: [0, 29] } };
  } };
  const resolved = await resolveCatalogStream(client, 'link-token', 'cyberpunk-edgerunners-2', async url => {
    assert.equal(url, 'https://megaplay.buzz/videojs/stream/s-2/766094/sub');
    return {
      url: 'https://rotating-video.example/master.m3u8', type: 'hls',
      subtitles: [{ url: 'https://rotating-subs.example/en.vtt', label: 'English' }],
    };
  });
  assert.deepEqual(calls, [{ path: '/stream', params: { id: 'link-token', slug: 'cyberpunk-edgerunners-2' } }]);
  assert.equal(resolved.type, 'hls');
  assert.equal(resolved.linkId, 'link-token');
  assert.deepEqual(resolved.skipData.intro, [0, 29]);
  assert.equal(assertProxyableUrl(resolved.url).ok, true);
  assert.equal(assertProxyableUrl(resolved.subtitles[0].url).ok, true);
});

test('invalid embed URLs and missing or private video destinations fail explicitly', async () => {
  const supported = { get: async () => ({ url: 'https://megaplay.buzz/stream/s-2/766094/sub' }) };
  await assert.rejects(resolveCatalogStream({ get: async () => ({ url: 'https://evil.example/player' }) }, 'x', 'test', async () => {
    assert.fail('unsupported embed must not be fetched');
  }), /supported video embed/);
  for (const url of [null, 'http://cdn.example/video.m3u8', 'https://127.0.0.1/private.m3u8']) {
    await assert.rejects(resolveCatalogStream(supported, 'x', 'test', async () => ({ url })), /stream|destination/i);
  }
});
