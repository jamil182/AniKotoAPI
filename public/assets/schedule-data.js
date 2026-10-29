/** Calendar dates are handled in UTC to avoid browser DST and month-boundary errors.
 * @param {unknown} value @returns {value is string}
 */
export function isScheduleDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** @param {string} value @param {number} days */
export function shiftScheduleDate(value, days) {
  if (!isScheduleDate(value) || !Number.isInteger(days)) throw new TypeError('Invalid schedule date');
  const date = new Date(value + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** @param {string} selected @returns {import('./schedule.types.js').ScheduleDay[]} */
export function scheduleWeek(selected) {
  if (!isScheduleDate(selected)) throw new TypeError('Invalid schedule date');
  const weekday = new Date(selected + 'T00:00:00Z').getUTCDay();
  const monday = shiftScheduleDate(selected, -((weekday + 6) % 7));
  const format = options => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options });
  return Array.from({ length: 7 }, (_, index) => {
    const date = shiftScheduleDate(monday, index), time = new Date(date + 'T00:00:00Z');
    return { date, label: format({ month: 'short', day: '2-digit' }).format(time),
      weekday: format({ weekday: 'short' }).format(time), fullLabel: format({ dateStyle: 'full' }).format(time) };
  });
}

/** @param {Date} [date] */
export function localScheduleDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** @param {string} date */
export function scheduleTimezone(date) {
  if (!isScheduleDate(date)) throw new TypeError('Invalid schedule date');
  const [year, month, day] = date.split('-').map(Number);
  return -new Date(year, month - 1, day).getTimezoneOffset() / 60;
}

/** @param {import('./schedule.types.js').ScheduleRow} row */
export function scheduleLinks(row) {
  if (typeof row.slug !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,239}$/i.test(row.slug)) return { anime: null, episode: null };
  const anime = '/anime/' + encodeURIComponent(row.slug);
  const episode = Number(row.episode_no);
  return { anime, episode: Number.isFinite(episode) && episode > 0 && episode <= 100000
    ? '/api/catalog/schedule-watch?slug=' + encodeURIComponent(row.slug) + '&ep=' + encodeURIComponent(episode) : null };
}
