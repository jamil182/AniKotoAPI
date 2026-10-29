import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import express from 'express';
import { migrate } from '../db/db.js';
import { createVisitorService, visitorEvent } from './visitors.js';
import { createVisitorGeo } from './visitorGeo.js';
import { isPublicIp, visitorAddress } from './visitorAddress.js';
import { createVisitorsRouter } from '../routes/visitors.route.js';

const noGeo = { lookup: async () => ({ country: '', region: '', city: '', status: 'disabled' }) };
const view = (path = '/home', eventId = randomUUID()) => ({ path, eventId, type: 'view' });
function fixture(t, initial = Date.UTC(2026, 9, 30, 10)) {
  const db = new Database(':memory:');
  migrate(db);
  let time = initial;
  const options = { now: () => time, geo: noGeo };
  const service = createVisitorService(() => db, options);
  t.after(async () => { await new Promise(resolve => setImmediate(resolve)); db.close(); });
  return { db, service, options, tick: ms => { time += ms; } };
}

test('visitor payloads exclude credentials, query strings, external URLs and malformed events', () => {
  for (const path of ['/admin', '/login', '/api/admin/library', '/home?token=secret', '//evil.test', '/watch/a/1#secret', '/assets/app.js']) assert.equal(visitorEvent(view(path)), null);
  for (const body of [null, [], {}, { ...view(), eventId: 'bad' }, { ...view(), type: 'click' }, { ...view(), path: 42 }]) assert.equal(visitorEvent(body), null);
  for (const path of ['/', '/home', '/browse', '/watch/naruto/1.5', '/anime/naruto', '/privacy.html']) assert.deepEqual(visitorEvent(view(path))?.path, path);
});

test('page retries and multiple tabs count views once; heartbeats expire online and never inflate views', t => {
  const f = fixture(t), event = view();
  assert.deepEqual(f.service.record('8.8.8.8', 'Firefox', { ...event, type: 'heartbeat' }), { needsView: true });
  f.service.record('8.8.8.8', 'Firefox', event);
  f.service.record('8.8.8.8', 'Firefox', event);
  f.tick(30_000);
  f.service.record('8.8.8.8', 'Firefox', { ...event, type: 'heartbeat' });
  f.service.record('8.8.8.8', 'Firefox', view('/anime/naruto'));
  let stats = f.service.stats();
  assert.equal(stats.online, 1);
  assert.deepEqual(stats.totals, { visits: 1, pageviews: 2 });
  assert.deepEqual(stats.today, { visitors: 1, visits: 1, pageviews: 2 });
  assert.equal(stats.visitors[0].path, '/anime/naruto');
  f.tick(90_001);
  assert.equal(f.service.stats().online, 0);
  f.tick(1_800_000);
  f.service.record('8.8.8.8', 'Firefox', view());
  assert.deepEqual(f.service.stats().totals, { visits: 2, pageviews: 3 });
  assert.equal(f.service.stats().today.visitors, 1);
});

test('WIB day boundary, persistent restart identity, pagination and raw-record retention preserve totals', t => {
  const f = fixture(t, Date.UTC(2026, 9, 30, 16, 59, 50)), event = view();
  f.service.record('8.8.8.8', 'Firefox', event);
  assert.equal(f.service.stats().daily.at(-1).day, '2026-10-30');
  f.tick(30_000);
  const restarted = createVisitorService(() => f.db, f.options);
  restarted.record('8.8.8.8', 'Firefox', { ...event, type: 'heartbeat' });
  assert.equal(restarted.stats().daily.at(-1).day, '2026-10-31');
  assert.deepEqual(restarted.stats().today, { visitors: 1, visits: 0, pageviews: 0 });
  for (let index = 1; index <= 22; index++) restarted.record(`8.8.4.${index}`, 'Firefox', view());
  assert.equal(restarted.stats().online, 23);
  assert.equal(restarted.stats(1).visitors.length, 20);
  assert.equal(restarted.stats(2).visitors.length, 3);
  assert.equal(restarted.stats(100).page, 2);
  const before = restarted.stats().totals;
  f.tick(31 * 86_400_000);
  assert.equal(restarted.stats().total, 0);
  assert.deepEqual(restarted.stats().totals, before);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM visitor_events').get().count, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM visitor_daily_seen').get().count, 0);
});

test('only verified Cloudflare upstreams can supply a visitor address', () => {
  const req = (ip, supplied) => ({ ip, get: name => name === 'cf-connecting-ip' ? supplied : undefined });
  assert.equal(visitorAddress(req('104.16.1.2', '1.1.1.1')), '1.1.1.1');
  assert.equal(visitorAddress(req('2606:4700::1111', '8.8.8.8')), '8.8.8.8');
  assert.equal(visitorAddress(req('8.8.8.8', '1.1.1.1')), '8.8.8.8');
  assert.equal(visitorAddress(req('::ffff:127.0.0.1', '1.1.1.1')), '127.0.0.1');
  assert.equal(visitorAddress(req('104.16.1.2', '1.1.1.1, 8.8.8.8')), '104.16.1.2');
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '::1', 'fc00::1', 'fe80::1', '2001:db8::1', 'bad']) assert.equal(isPublicIp(ip), false, ip);
  for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPublicIp(ip), true, ip);
});

test('geolocation caches successes, excludes private IPs and survives upstream quotas and failures', async () => {
  let calls = 0, time = Date.UTC(2026, 9, 30);
  const geo = createVisitorGeo({ now: () => time, fetchImpl: async () => {
    calls++;
    return Response.json({ success: true, city: 'Jakarta', region: 'Jakarta', country: 'Indonesia' });
  } });
  assert.equal((await geo.lookup('127.0.0.1')).status, 'local');
  assert.equal(calls, 0);
  const [one, two] = await Promise.all([geo.lookup('8.8.8.8'), geo.lookup('8.8.8.8')]);
  assert.equal(one.city, 'Jakarta'); assert.deepEqual(one, two); assert.equal(calls, 1);
  const quota = createVisitorGeo({ now: () => time, fetchImpl: async () => { calls++; return new Response('', { status: 429 }); } });
  assert.equal((await quota.lookup('1.1.1.1')).status, 'unavailable');
  assert.equal((await quota.lookup('8.8.8.8')).status, 'unavailable');
  assert.equal(calls, 2);
  time += 86_400_001;
  await quota.lookup('1.1.1.1');
  assert.equal(calls, 3);
  const failing = createVisitorGeo({ fetchImpl: async () => { throw new Error('Network down'); } });
  assert.equal((await failing.lookup('8.8.8.8')).status, 'unavailable');
  const disabled = createVisitorGeo({ enabled: false, fetchImpl: async () => { throw new Error('Must not run'); } });
  assert.equal((await disabled.lookup('8.8.8.8')).status, 'disabled');
});

test('geolocation limits parallel requests without an unbounded queue', async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const geo = createVisitorGeo({ fetchImpl: async () => { calls++; await wait; return Response.json({ success: true, country: 'Test' }); } });
  const first = geo.lookup('8.8.8.8'), second = geo.lookup('1.1.1.1');
  assert.equal((await geo.lookup('9.9.9.9')).status, 'unavailable');
  assert.equal(calls, 2);
  release();
  await Promise.all([first, second]);
});

test('visitor HTTP routes enforce admin auth, same-origin writes, payload validation and bot exclusion', async t => {
  const f = fixture(t);
  const priorToken = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = 'visitor-admin-test';
  t.after(() => { if (priorToken === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = priorToken; });
  const app = express(); app.set('trust proxy', 'loopback'); app.use(express.json());
  app.use('/api', createVisitorsRouter(() => f.db, f.options));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, extra = {}) => fetch(base + '/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Firefox', ...extra }, body: JSON.stringify(body) });
  assert.equal((await fetch(base + '/api/admin/visitors')).status, 401);
  const headers = { 'X-Admin-Token': process.env.ADMIN_TOKEN };
  assert.equal((await fetch(base + '/api/admin/visitors?page[]=1', { headers })).status, 400);
  assert.equal((await post(view(), { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await post(view('/admin'))).status, 400);
  assert.equal((await post(view(), { 'User-Agent': 'Googlebot' })).status, 200);
  assert.equal((await post(view(), { Origin: base, 'X-Forwarded-For': '8.8.8.8', 'CF-Connecting-IP': '1.1.1.1' })).status, 200);
  const response = await fetch(base + '/api/admin/visitors', { headers });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { results } = await response.json();
  assert.equal(results.totals.pageviews, 1);
  assert.equal(results.visitors[0].ip, '8.8.8.8');
  assert.equal(JSON.stringify(results).includes('secret'), false);
});
