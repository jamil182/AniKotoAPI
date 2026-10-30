import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as cheerio from 'cheerio';
import { airingCountdown, filterWeeklyRows, isWeeklySchedule, weeklyDaysHTML, weeklyTimelineHTML } from './weekly-schedule-view.js';
import { localScheduleDate } from './schedule-data.js';

const now = Date.UTC(2026, 9, 30, 1);
const row = { slug: 'mazenchu-c2150', title: 'Mazenchu', japaneseTitle: '', time: '09:05', episode_no: 5,
  language: 'sub', poster: 'https://cdn.example/poster.jpg', synopsis: 'Food & friendship', genres: ['Comedy'], airingAt: now / 1000 + 3900 };

test('weekly responses reject malformed metadata without turning failures into an empty day', () => {
  assert.equal(isWeeklySchedule([row]), true); assert.equal(isWeeklySchedule([]), true);
  for (const value of [null, {}, [null], [{ ...row, language: 'unknown' }], [{ ...row, airingAt: Infinity }], [{ ...row, genres: [12] }], [{ ...row, episode_no: -1 }]]) assert.equal(isWeeklySchedule(value), false);
});

test('weekly countdowns distinguish future, past and unknown times without claiming release availability', () => {
  assert.equal(airingCountdown(row.airingAt, now), 'IN 1H 5M');
  assert.equal(airingCountdown(now / 1000 + 30, now), 'IN <1M');
  assert.equal(airingCountdown(now / 1000 - 1, now), 'EST. AIRED');
  assert.equal(airingCountdown(null, now), 'TIME TBA');
  assert.equal(airingCountdown(now / 1000 + 27 * 3600, now), 'IN 1D 3H');
});
test('language filters and day counts reflect source data and do not invent DUB episodes', () => {
  const rows = [row, { ...row, language: null }];
  assert.equal(filterWeeklyRows(rows, 'all').length, 2);
  assert.equal(filterWeeklyRows(rows, 'sub').length, 1);
  assert.equal(filterWeeklyRows(rows, 'dub').length, 0);
  const cache = new Map([['2026-10-30', { rows, at: now }]]);
  const $ = cheerio.load(weeklyDaysHTML('2026-10-30', '2026-10-30', cache, 'sub'));
  assert.equal($('[aria-pressed="true"]').length, 1);
  assert.match($('[aria-pressed="true"]').text(), /TODAY.*Fri.*1 eps/s);
  assert.equal($('[data-date="2026-10-31"] small').text(), '—');
});
test('weekly timeline groups simultaneous episodes, inserts NOW once and escapes every metadata field', () => {
  const malicious = '<img src=x onerror=alert(1)>';
  const html = weeklyTimelineHTML([row, { ...row, title: malicious, language: '"><svg onload=alert(1)>', synopsis: malicious, poster: 'javascript:alert(1)', genres: [malicious] }], localScheduleDate(new Date(now)), now);
  const $ = cheerio.load(html);
  assert.equal($('.weekly-group').length, 1); assert.equal($('.weekly-card').length, 2); assert.equal($('.weekly-now').length, 1);
  assert.equal($('svg,img[onerror]').length, 0); assert.equal($('h2').last().text(), malicious);
  assert.equal($('.weekly-poster').last().attr('src'), '/favicon.png');
  assert.match($('.weekly-card').first().attr('href'), /^\/api\/catalog\/schedule-watch\?/);
  assert.ok(!weeklyTimelineHTML([row], '2026-10-20', now).includes('class="weekly-now"'));
  assert.match(weeklyTimelineHTML([], '2026-10-30', now), /Tidak ada episode/);
});
test('shared top navigation exposes the working Weekly Schedule destination and current-page marker', () => {
  const code = fs.readFileSync(new URL('./api.js', import.meta.url), 'utf8');
  const html = runInNewContext(code + '\nnavHTML("schedule");', { location: { protocol: 'https:', origin: 'https://site.test' }, document: { addEventListener() {} } }, { timeout: 1000 });
  const $ = cheerio.load(html), link = $('a.nav-weekly');
  assert.equal(link.attr('href'), '/schedule'); assert.equal(link.attr('aria-current'), 'page');
  assert.equal(link.attr('aria-label'), 'Weekly Schedule'); assert.equal(link.find('svg').attr('aria-hidden'), 'true');
  assert.equal($('a[href="/login"]').length, 1); assert.equal($('a[href="/register"]').length, 1);
});
