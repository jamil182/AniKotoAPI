import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createMiruroReleases, parseMiruroReleases, decodeReleaseTable } from './miruroReleases.js';

function payload(sub, dub = []) {
  const table = [];
  function encode(value) {
    const index = table.length; table.push(null);
    table[index] = value !== null && typeof value === 'object'
      ? Array.isArray(value) ? value.map(encode) : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encode(child)])) : value;
    return index;
  }
  encode({ raw: { latest: sub }, dub: { latest: dub } });
  return JSON.stringify({ type: 'data', nodes: [] }) + '\n' + JSON.stringify({ type: 'chunk', id: 1, data: table });
}
const release = (id = 21, episode = 8, airingAt = 1795352400) => ({ externalIds: { anilist: [String(id)], mal: ['21'] }, title: { english: 'New episode' }, coverUrl: 'https://example.com/p.jpg', episode, episodeCounts: { raw: episode, sub: episode, dub: 6 }, episodeCount: 12, format: 'TV', seasonYear: 2026, airingAt });

test('reads deferred Sub/Dub release rails, preserves exact identities and sorts actual release timestamps', () => {
  const rows = parseMiruroReleases(payload([release(21, 8), release(22, 1, 1795352500), release(21, 8), release(0), { ...release(), episode: -1 }], [release(21, 6)]));
  assert.deepEqual(rows.sub.map(row => row.id), ['al-22', 'al-21']);
  assert.equal(rows.sub[1].latestEpisode, 8);
  assert.equal(rows.sub[1].sub, 8);
  assert.equal(rows.dub[0].latestEpisode, 6);
  assert.equal(rows.dub[0].releaseLanguage, 'dub');
  assert.equal(rows.sub[0].releasedAt, new Date(1795352500 * 1000).toISOString());
});
test('rejects malformed, cyclic, excessive and prototype-polluting references without evaluating script', () => {
  for (const input of ['<script>bad()</script>', '{}', payload([], []), 'x'.repeat(2 * 1024 * 1024 + 1)]) assert.throws(() => parseMiruroReleases(input));
  for (const table of [[{ child: 0 }], [{ child: 99 }], [{ child: -8 }], [JSON.parse('{"__proto__":1}'), {}]]) assert.throws(() => decodeReleaseTable(table));
  const rows = parseMiruroReleases(payload([{ ...release(), coverUrl: 'javascript:alert(1)' }]));
  assert.equal(rows.sub[0].poster, undefined);
  assert.equal({}.polluted, undefined);
});
test('deduplicates polling, paginates the same feed and refreshes after one minute', async () => {
  let calls = 0, time = 0;
  const service = createMiruroReleases({ now: () => time, request: async (url, config) => {
    calls++; assert.equal(url, 'https://miruro.cx/__data.json'); assert.equal(config.headers.Accept, 'application/json');
    return { data: payload(Array.from({ length: 50 }, (_, i) => release(i + 1, calls)), [release(21, 6)]) };
  } });
  const pages = await Promise.all([service.page(), service.page({ page: '2' }), service.page({ language: 'dub' })]);
  assert.equal(calls, 1); assert.equal(pages[0].data.length, 21); assert.equal(pages[0].totalPages, 3);
  assert.equal(pages[1].data[0].id, 'al-22'); assert.equal(pages[2].data[0].latestEpisode, 6);
  time = 61000; assert.equal((await service.page()).data[0].latestEpisode, 2); assert.equal(calls, 2);
  await assert.rejects(service.page({ language: 'unknown' }), /Invalid/);
  await assert.rejects(service.page({ page: '0' }), /Invalid/);
});
test('retains the last valid feed across restarts, backs off failures and expires stale data', async () => {
  const db = new Database(':memory:'); let time = 0, failures = 0;
  try {
    const initial = createMiruroReleases({ getDatabase: () => db, now: () => time, request: async () => ({ data: payload([release()]) }) });
    await initial.page(); time = 61000;
    const restarted = createMiruroReleases({ getDatabase: () => db, now: () => time, request: async () => { failures++; throw Error('blocked'); } });
    assert.equal((await restarted.page()).data[0].latestEpisode, 8);
    await restarted.page(); assert.equal(failures, 1);
    time = 86400001; await assert.rejects(restarted.page(), /temporarily unavailable/);
    await assert.rejects(restarted.page(), /temporarily unavailable/); assert.equal(failures, 2);
  } finally { db.close(); }
});
