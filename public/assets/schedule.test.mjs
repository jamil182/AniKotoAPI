import test from 'node:test';
import assert from 'node:assert/strict';
import { isScheduleDate, scheduleWeek, shiftScheduleDate, scheduleLinks } from './schedule-data.js';
import { scheduleDaysHTML, scheduleRowsHTML, createScheduleLoader } from './schedule-page.js';

test('calendar handles leap dates, Monday boundaries and weeks spanning months or years', () => {
  assert.equal(isScheduleDate('2024-02-29'), true); assert.equal(isScheduleDate('2026-02-29'), false);
  assert.equal(shiftScheduleDate('2024-02-28', 1), '2024-02-29');
  const days = scheduleWeek('2027-01-01');
  assert.equal(days.length, 7); assert.equal(days[0].date, '2026-12-28'); assert.equal(days[6].date, '2027-01-03');
  assert.equal(scheduleWeek('2026-10-26')[0].date, '2026-10-26');
  const html = scheduleDaysHTML('2026-10-30', '2026-10-30');
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
  assert.match(html, /data-date="2026-11-01"/);
});
test('schedule links use canonical IDs, escape titles and never create a player link from a title', () => {
  const row = { slug: 'mazenchu-c2150', title: '<img onerror=alert(1)>', japaneseTitle: '', time: '07:50', episode_no: 5 };
  assert.equal(scheduleLinks(row).anime, '/anime/mazenchu-c2150');
  assert.match(scheduleLinks(row).episode, /schedule-watch\?slug=mazenchu-c2150&ep=5/);
  const html = scheduleRowsHTML([row, { ...row, slug: null }]);
  assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('<img'));
  assert.equal((html.match(/href="\/anime\//g) || []).length, 1);
  assert.equal(scheduleLinks({ ...row, slug: 'https://evil.test' }).anime, null);
  assert.equal(scheduleLinks({ ...row, episode_no: null }).episode, null);
  assert.match(scheduleRowsHTML([]), /Tidak ada jadwal/);
});
test('changing date cancels obsolete requests and discards late results without overlapping the same request', async () => {
  const pending = [], data = [], errors = [];
  const loader = createScheduleLoader({ fetchDay: (date, timezone, signal) => new Promise((resolve, reject) => pending.push({ date, signal, resolve, reject })), onData: (rows, date) => data.push(date), onError: error => errors.push(error) });
  const old = loader.load('2026-10-30', 7), duplicate = loader.load('2026-10-30', 7);
  assert.equal(old, duplicate); assert.equal(pending.length, 1);
  const latest = loader.load('2026-10-31', 7); assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve([]); await latest; pending[0].resolve([]); await old;
  assert.deepEqual(data, ['2026-10-31']); assert.deepEqual(errors, []);
  const failed = loader.load('2026-11-01', 7); pending[2].reject(new Error('Offline')); await failed;
  assert.equal(errors.length, 1); assert.deepEqual(data, ['2026-10-31']);
  const cancelled = loader.load('2026-11-02', 7); loader.cancel(); pending[3].resolve([]); await cancelled;
  assert.deepEqual(data, ['2026-10-31']);
});
