import { extractSchedule, extractWeeklySchedule } from '../extractors/schedule.extractor.js';
import { isScheduleDate } from '../../public/assets/schedule-data.js';
import { AniKotoError } from './anikotoApi.js';

/** @param {{date?: unknown, tz?: unknown}} query */
export function scheduleQuery(query) {
  if (!isScheduleDate(query.date)) throw new AniKotoError('Invalid schedule date (YYYY-MM-DD)', 400);
  const value = query.tz === undefined ? '7' : query.tz;
  if (typeof value !== 'string' || !/^-?\d{1,2}(?:\.(?:25|5|75))?$/.test(value)) throw new AniKotoError('Invalid schedule timezone', 400);
  const timezone = Number(value);
  if (timezone < -12 || timezone > 14) throw new AniKotoError('Invalid schedule timezone', 400);
  return { date: query.date, timezone };
}

/** @param {{load?: typeof extractSchedule, now?: () => number}} options */
export function createScheduleService({ load = extractSchedule, now = Date.now } = {}) {
  const cache = new Map(), pending = new Map();
  return {
    /** @param {string} date @param {number} [timezone] */
    async get(date, timezone = 7) {
      scheduleQuery({ date, tz: String(timezone) });
      const key = date + ':' + timezone, hit = cache.get(key);
      if (hit && hit.expires > now()) return hit.rows;
      if (pending.has(key)) return pending.get(key);
      if (pending.size >= 8) throw new AniKotoError('Schedule is busy. Please retry shortly.', 503, '15');
      const operation = (async () => {
        try {
          const rows = await load(date, { timezone });
          if (!Array.isArray(rows)) throw new Error('Invalid schedule data');
          if (cache.size >= 40) cache.delete(cache.keys().next().value);
          cache.set(key, { rows, expires: now() + 60_000 });
          return rows;
        } catch (error) {
          if (error instanceof AniKotoError) throw error;
          throw new AniKotoError('Jadwal belum dapat dimuat. Silakan coba kembali.', 502);
        } finally { pending.delete(key); }
      })();
      pending.set(key, operation);
      return operation;
    },
  };
}

export const scheduleService = createScheduleService();
export const weeklyScheduleService = createScheduleService({ load: extractWeeklySchedule });
