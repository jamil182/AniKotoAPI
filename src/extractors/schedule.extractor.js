import * as cheerio from 'cheerio';
import { fetchWithMirror } from '../helper/mirror.helper.js';
import { isScheduleDate } from '../../public/assets/schedule-data.js';

/** @param {string | undefined} href */
function scheduleLink(href) {
  try {
    if (!href) return { slug: null, episode: null };
    const url = new URL(href, 'https://anikoto.cz');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return { slug: null, episode: null };
    const match = /^\/(?:watch|anime)\/([a-z0-9][a-z0-9_-]{0,239})(?:\/(?:ep-)?(\d+(?:\.\d+)?))?\/?$/i.exec(url.pathname);
    return match ? { slug: match[1], episode: match[2] ? Number(match[2]) : null } : { slug: null, episode: null };
  } catch { return { slug: null, episode: null }; }
}

/** @param {string} html @returns {import('../../public/assets/schedule.types.js').ScheduleRow[]} */
export function parseScheduleHtml(html) {
  const $ = cheerio.load(html);
  return $('.item').slice(0, 200).map((index, element) => {
    const item = $(element);
    const title = item.find('.title').text().trim().slice(0, 300);
    if (!title) return null;
    const href = item.attr('href') || item.find('a[href]').first().attr('href');
    const { slug, episode } = scheduleLink(href);
    const number = episode || Number(item.find('.ep').text().match(/\d+(?:\.\d+)?/)?.[0]);
    const time = item.find('.time').text().trim();
    return { slug, title, japaneseTitle: (item.find('.title').attr('data-jp') || '').slice(0, 300),
      time: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '',
      episode_no: Number.isFinite(number) && number > 0 && number <= 100000 ? number : null };
  }).get();
}

/** @param {string} date
 * @param {{timezone?: number, signal?: AbortSignal, request?: typeof fetchWithMirror}} options
 */
async function scheduleDocument(date, { timezone = 7, signal, request = fetchWithMirror } = {}, weekly = false) {
  if (!isScheduleDate(date) || !Number.isFinite(timezone) || timezone < -12 || timezone > 14 || !Number.isInteger(timezone * 4)) throw new TypeError('Invalid schedule date or timezone');
  const time = Date.parse(date + 'T00:00:00Z') / 1000 - timezone * 3600;
  const query = new URLSearchParams({ tz: String(timezone), time: String(time) });
  const deadline = AbortSignal.timeout(12000);
  const response = await request('/ajax/schedule/' + (weekly ? 'page/date?' : 'date?') + query, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' }, timeout: 3500, retries: 0, useProxy: false,
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  });
  let data = response.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { throw new Error('Invalid schedule response'); }
  }
  if (!data || Number(data.status) !== 200 || typeof data.result !== 'string') throw new Error('Schedule source unavailable');
  return data.result;
}

/** @param {string} date @param {Parameters<typeof scheduleDocument>[1]} options */
export async function extractSchedule(date, options) {
  return parseScheduleHtml(await scheduleDocument(date, options));
}

/** @param {string} html @param {number} [timezone]
 * @returns {import('../../public/assets/schedule.types.js').WeeklyScheduleRow[]}
 */
export function parseWeeklyScheduleHtml(html, timezone = 7) {
  const $ = cheerio.load(html), rows = [], seen = new Set();
  $('.sc-card').slice(0, 200).each((index, element) => {
    const card = $(element), title = card.find('.sc-name').text().trim().slice(0, 300);
    if (!title) return;
    const link = scheduleLink(card.attr('href'));
    const episode = link.episode || Number(card.find('.sc-ep').text().match(/\d+(?:\.\d+)?/)?.[0]);
    const base = { slug: link.slug, title, japaneseTitle: (card.find('.sc-name').attr('data-jp') || '').slice(0, 300),
      episode_no: Number.isFinite(episode) && episode > 0 && episode <= 100000 ? episode : null };
    const rawTime = Number(card.closest('.sc-grp').attr('data-airing'));
    const airingAt = Number.isSafeInteger(rawTime) && rawTime > 0 && rawTime <= 253402300799 ? rawTime : null;
    const kind = card.attr('data-type');
    const language = kind === 'sub' || kind === 'dub' ? kind : null;
    const key = JSON.stringify([base.slug, title, base.episode_no, language, airingAt]);
    if (seen.has(key)) return;
    seen.add(key);
    let poster = null;
    try {
      const url = new URL(card.find('img').attr('src'));
      if (url.protocol === 'https:' && !url.username && !url.password) poster = url.href;
    } catch { /* Cards remain usable without artwork. */ }
    rows.push({ ...base, poster, language, airingAt,
      time: airingAt === null ? '' : new Date((airingAt + timezone * 3600) * 1000).toISOString().slice(11, 16),
      synopsis: card.find('.sc-des').text().trim().slice(0, 2000),
      genres: [...new Set(card.find('.sc-gen span').map((i, genre) => $(genre).text().trim().slice(0, 60)).get().filter(Boolean))].slice(0, 20),
    });
  });
  return rows;
}

/** @param {string} date @param {Parameters<typeof scheduleDocument>[1]} options */
export async function extractWeeklySchedule(date, options = {}) {
  return parseWeeklyScheduleHtml(await scheduleDocument(date, options, true), options.timezone ?? 7);
}
