import * as cheerio from 'cheerio';
import { fetchWithMirror } from '../helper/mirror.helper.js';
import { isScheduleDate } from '../../public/assets/schedule-data.js';

/** @param {string} html @returns {import('../../public/assets/schedule.types.js').ScheduleRow[]} */
export function parseScheduleHtml(html) {
  const $ = cheerio.load(html);
  return $('.item').slice(0, 200).map((index, element) => {
    const item = $(element);
    const title = item.find('.title').text().trim().slice(0, 300);
    if (!title) return null;
    const href = item.attr('href') || item.find('a[href]').first().attr('href');
    let slug = null, episode = null;
    if (href) {
      try {
        const url = new URL(href, 'https://anikoto.cz');
        if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
          const match = /^\/(?:watch|anime)\/([a-z0-9][a-z0-9_-]{0,239})(?:\/(?:ep-)?(\d+(?:\.\d+)?))?\/?$/i.exec(url.pathname);
          if (match) { slug = match[1]; episode = match[2] ? Number(match[2]) : null; }
        }
      } catch { /* Missing source links remain text, never a fabricated slug. */ }
    }
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
export async function extractSchedule(date, { timezone = 7, signal, request = fetchWithMirror } = {}) {
  if (!isScheduleDate(date) || !Number.isFinite(timezone) || timezone < -12 || timezone > 14 || !Number.isInteger(timezone * 4)) throw new TypeError('Invalid schedule date or timezone');
  const time = Date.parse(date + 'T00:00:00Z') / 1000 - timezone * 3600;
  const query = new URLSearchParams({ tz: String(timezone), time: String(time) });
  const deadline = AbortSignal.timeout(12000);
  const response = await request('/ajax/schedule/date?' + query, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' }, timeout: 3500, retries: 0, useProxy: false,
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  });
  let data = response.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { throw new Error('Invalid schedule response'); }
  }
  if (!data || Number(data.status) !== 200 || typeof data.result !== 'string') throw new Error('Schedule source unavailable');
  return parseScheduleHtml(data.result);
}
