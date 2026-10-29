import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createScheduleService, scheduleQuery } from './schedule.js';
import { createCatalogRouter } from '../routes/catalog.route.js';
import { openDb } from '../db/db.js';
import { upsertAnime } from '../db/library.repo.js';
import { createPublishedCatalog } from './publishedCatalog.js';

test('schedule query rejects impossible dates, arrays and invalid timezone offsets', () => {
  assert.deepEqual(scheduleQuery({ date: '2026-10-30' }), { date: '2026-10-30', timezone: 7 });
  assert.equal(scheduleQuery({ date: '2026-10-30', tz: '5.75' }).timezone, 5.75);
  for (const query of [{ date: '2026-02-30' }, { date: ['2026-10-30'] }, { date: '2026-10-30', tz: ['7'] }, { date: '2026-10-30', tz: '14.25' }, { date: '2026-10-30', tz: '7.1' }]) assert.throws(() => scheduleQuery(query), error => error.status === 400);
});
test('schedule cache separates dates and timezones, deduplicates requests and retries failed source calls', async () => {
  let time = 0, calls = 0, fail = false;
  const service = createScheduleService({ now: () => time, load: async (date, { timezone }) => {
    calls++; if (fail) throw new Error('Source down'); return [{ title: date + '/' + timezone }];
  } });
  const one = await Promise.all([service.get('2026-10-30', 7), service.get('2026-10-30', 7)]);
  assert.deepEqual(one[0], one[1]); assert.equal(calls, 1);
  await service.get('2026-10-30', 0); await service.get('2026-10-31', 7); assert.equal(calls, 3);
  time = 60_001; fail = true;
  await assert.rejects(service.get('2026-10-30', 7), error => error.status === 502);
  fail = false; await service.get('2026-10-30', 7); assert.equal(calls, 5);
});
test('schedule route preserves canonical IDs and checks release availability before redirecting to a player', async t => {
  let failed = false, sourceCalls = 0;
  const client = { get: async path => {
    sourceCalls++;
    if (failed) throw new Error('Upstream unavailable');
    assert.equal(path, '/episodes/mazenchu-c2150');
    return { episodes: [{ episode_no: 5 }] };
  } };
  const dates = [];
  const app = express(); app.use('/catalog', createCatalogRouter(client, null, { schedule: { get: async (date, timezone) => {
    dates.push({ date, timezone }); return [{ slug: 'mazenchu-c2150', title: 'Mazenchu', episode_no: 5, time: '07:50' }];
  } } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/catalog`;
  const response = await fetch(base + '/schedule?date=2026-10-30&tz=7');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).results[0].slug, 'mazenchu-c2150');
  assert.deepEqual(dates, [{ date: '2026-10-30', timezone: 7 }]);
  for (const path of ['/schedule?date=2026-02-30', '/schedule?date=2026-10-30&tz[]=7', '/schedule-watch?slug=../secret&ep=1', '/schedule-watch?slug=mazenchu-c2150&ep=nan']) assert.equal((await fetch(base + path)).status, 400);
  assert.equal(sourceCalls, 0);
  const watch = await fetch(base + '/schedule-watch?slug=mazenchu-c2150&ep=5', { redirect: 'manual' });
  assert.equal(watch.status, 303); assert.equal(watch.headers.get('location'), '/watch/mazenchu-c2150/5');
  const future = await fetch(base + '/schedule-watch?slug=mazenchu-c2150&ep=6', { redirect: 'manual' });
  assert.equal(future.headers.get('location'), '/anime/mazenchu-c2150');
  failed = true;
  const unavailable = await fetch(base + '/schedule-watch?slug=mazenchu-c2150&ep=5', { redirect: 'manual' });
  assert.equal(unavailable.headers.get('location'), '/anime/mazenchu-c2150');
});

test('managed schedules only expose published titles and preserve their custom public slugs', async t => {
  const db = openDb(':memory:'); t.after(() => db.close());
  const publicId = upsertAnime(db, { title: 'Published title', slug: 'custom-public', malId: 20 });
  upsertAnime(db, { title: 'Private draft', slug: 'private-draft', malId: 21 });
  db.prepare("UPDATE anime SET publication_state='published',source_slug='original-source-a1b2c' WHERE id=?").run(publicId);
  const catalog = createPublishedCatalog(() => db, { get: async () => { throw new Error('Must not use broken hosted schedules'); } }, {
    schedule: { get: async () => [
      { title: 'Published title', slug: 'original-source-a1b2c', time: '07:50', episode_no: 1 },
      { title: 'Private draft', slug: 'private-draft', time: '08:50', episode_no: 1 },
    ] },
  });
  const rows = await catalog.schedule('2026-10-30', 7);
  assert.equal(rows.length, 1); assert.equal(rows[0].slug, 'custom-public');
});
