import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSchedule, parseScheduleHtml, extractWeeklySchedule, parseWeeklyScheduleHtml } from './schedule.extractor.js';

const html = `<div class="items"><a class="item" href="https://anikoto.cz/watch/mazenchu-c2150/ep-5?type=sub"><div class="time">07:50</div><div class="ep"><span>Episode 5</span></div><div class="title" data-jp="Mazenchu">Mazenchu</div></a>
<a class="item" href="/watch/title-realid/ep-12.5"><div class="time">16:40</div><div class="title">Tom &amp; Jerry</div></a>
<div class="item"><div class="time">99:00</div><div class="ep">Episode 8</div><div class="title">No link</div></div>
<a class="item" href="javascript:alert(1)"><div class="title">Unsafe link</div></a></div>`;

test('schedule reads canonical source links, decoded titles and decimal episodes without inventing title slugs', () => {
  const rows = parseScheduleHtml(html);
  assert.deepEqual(rows[0], { slug: 'mazenchu-c2150', title: 'Mazenchu', japaneseTitle: 'Mazenchu', time: '07:50', episode_no: 5 });
  assert.equal(rows[1].slug, 'title-realid'); assert.equal(rows[1].title, 'Tom & Jerry'); assert.equal(rows[1].episode_no, 12.5);
  assert.equal(rows[2].slug, null); assert.equal(rows[2].time, ''); assert.equal(rows[2].episode_no, 8);
  assert.equal(rows[3].slug, null);
  assert.deepEqual(parseScheduleHtml('<div class="items"></div>'), []);
});
test('selected date uses the date endpoint and timezone-adjusted midnight instead of an ignored date parameter', async () => {
  const calls = [];
  const request = async (path, options) => { calls.push({ path, options }); return { data: JSON.stringify({ status: 200, result: html }) }; };
  await extractSchedule('2026-10-30', { timezone: 7, request });
  const first = new URL(calls[0].path, 'https://example.test');
  assert.equal(first.pathname, '/ajax/schedule/date');
  assert.equal(first.searchParams.get('tz'), '7'); assert.equal(first.searchParams.get('time'), '1793293200');
  assert.equal(calls[0].options.retries, 0); assert.ok(calls[0].options.signal instanceof AbortSignal);
  await extractSchedule('2026-10-31', { timezone: 7, request });
  assert.equal(Number(new URL(calls[1].path, 'https://example.test').searchParams.get('time')) - Number(first.searchParams.get('time')), 86400);
  for (const [date, timezone] of [['2026-02-30', 7], ['invalid', 7], ['2026-10-30', 15], ['2026-10-30', 7.1]]) await assert.rejects(extractSchedule(date, { timezone, request }), /Invalid/);
  assert.equal(calls.length, 2);
});
test('malformed source responses are errors rather than empty schedules', async () => {
  for (const data of ['<html>Cloudflare</html>', { status: 500, result: 'error' }, { status: 200 }]) {
    await assert.rejects(extractSchedule('2026-10-30', { request: async () => ({ data }) }), /response|unavailable/);
  }
});

test('weekly cards retain source language, posters, synopsis, genres and absolute airing timestamps', async () => {
  const card = `<div class="sc-grp" data-airing="1793321400"><a class="sc-card" href="/watch/mazenchu-c2150/ep-5?type=sub" data-type="sub"><img src="https://cdn.example/poster.jpg"><div class="sc-name" data-jp="Mazenchu">Mazenchu</div><div class="sc-ep">Episode 5</div><div class="sc-des">Food &amp; friendship</div><div class="sc-gen"><span>Comedy</span><span>Comedy</span></div></a></div>`;
  const rows = parseWeeklyScheduleHtml(card + card, 7);
  assert.equal(rows.length, 1); assert.equal(rows[0].language, 'sub');
  assert.equal(rows[0].airingAt, 1793321400); assert.equal(rows[0].time, '07:50');
  assert.equal(rows[0].poster, 'https://cdn.example/poster.jpg'); assert.equal(rows[0].synopsis, 'Food & friendship');
  assert.deepEqual(rows[0].genres, ['Comedy']);
  const unsafe = parseWeeklyScheduleHtml(card.replace('data-type="sub"', 'data-type="unknown"').replace('https://cdn.example/poster.jpg', 'javascript:alert(1)').replace('1793321400', 'not-a-time'));
  assert.equal(unsafe[0].language, null); assert.equal(unsafe[0].poster, null); assert.equal(unsafe[0].airingAt, null);
  await extractWeeklySchedule('2026-10-30', { timezone: 7, request: async path => {
    assert.match(path, /^\/ajax\/schedule\/page\/date\?/);
    return { data: { status: 200, result: card } };
  } });
});
