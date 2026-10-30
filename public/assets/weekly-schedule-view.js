import { scheduleLinks, scheduleWeek, localScheduleDate } from './schedule-data.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

/** @param {unknown} value @returns {value is import('./schedule.types.js').WeeklyScheduleRow[]} */
export function isWeeklySchedule(value) {
  return Array.isArray(value) && value.length <= 200 && value.every(row => row && typeof row === 'object'
    && typeof row.title === 'string' && typeof row.time === 'string' && typeof row.japaneseTitle === 'string'
    && (row.slug === null || typeof row.slug === 'string') && (row.poster === null || typeof row.poster === 'string')
    && typeof row.synopsis === 'string' && Array.isArray(row.genres) && row.genres.every(genre => typeof genre === 'string')
    && (row.language === null || row.language === 'sub' || row.language === 'dub')
    && (row.episode_no === null || (Number.isFinite(row.episode_no) && row.episode_no > 0))
    && (row.airingAt === null || (Number.isSafeInteger(row.airingAt) && row.airingAt > 0 && row.airingAt <= 253402300799)));
}

/** @param {import('./schedule.types.js').WeeklyScheduleRow[]} rows @param {string} language */
export function filterWeeklyRows(rows, language) {
  return language === 'sub' || language === 'dub' ? rows.filter(row => row.language === language) : rows;
}

/** @param {number | null} airingAt @param {number} now */
export function airingCountdown(airingAt, now) {
  if (!Number.isFinite(airingAt) || airingAt <= 0) return 'TIME TBA';
  const difference = airingAt * 1000 - now;
  if (difference <= 0) return 'EST. AIRED';
  if (difference < 60_000) return 'IN <1M';
  const minutes = Math.ceil(difference / 60_000), hours = Math.floor(minutes / 60);
  if (hours >= 24) return `IN ${Math.floor(hours / 24)}D ${hours % 24}H`;
  return hours ? `IN ${hours}H ${minutes % 60}M` : `IN ${minutes}M`;
}

/** @param {number} timestamp @param {boolean} [seconds] */
export function weeklyTimeParts(timestamp, seconds = false) {
  const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: true }).formatToParts(new Date(timestamp));
  return { time: parts.filter(part => ['hour', 'minute', 'second', 'literal'].includes(part.type)).map(part => part.value).join('').trim(), period: parts.find(part => part.type === 'dayPeriod')?.value || '' };
}

/** @param {string} selected @param {string} today @param {Map<string, {rows: import('./schedule.types.js').WeeklyScheduleRow[], at: number}>} cache @param {string} language */
export function weeklyDaysHTML(selected, today, cache, language) {
  return scheduleWeek(selected).map(day => {
    const rows = cache.get(day.date)?.rows;
    const count = rows ? filterWeeklyRows(rows, language).length + ' eps' : '—';
    const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(day.date + 'T00:00:00Z'));
    return `<button type="button" class="weekly-day${selected === day.date ? ' selected' : ''}" data-date="${day.date}" aria-pressed="${selected === day.date}" aria-label="${esc(day.fullLabel)}"><span>${esc(date)}${day.date === today ? ' · TODAY' : ''}</span><b>${esc(day.weekday)}</b><small>${count}</small></button>`;
  }).join('');
}

/** @param {import('./schedule.types.js').WeeklyScheduleRow} row @param {number} now */
function cardHTML(row, now) {
  const links = scheduleLinks(row), href = links.episode || links.anime;
  const language = row.language === 'sub' || row.language === 'dub' ? row.language : null;
  let poster = '/favicon.png';
  try { const url = new URL(row.poster); if (url.protocol === 'https:' && !url.username && !url.password) poster = url.href; } catch { /* Use the site's existing artwork. */ }
  const body = `<img class="weekly-poster" src="${esc(poster)}" loading="lazy" width="76" height="108" alt=""><div class="weekly-card-copy"><h2>${esc(row.title)}</h2><div class="weekly-meta">${language ? `<span class="weekly-language ${language}">${language.toUpperCase()}</span>` : ''}<span>${row.episode_no ? 'Episode ' + esc(row.episode_no) : 'Episode TBA'}</span></div>${row.synopsis ? `<p>${esc(row.synopsis)}</p>` : ''}<div class="weekly-genres">${(Array.isArray(row.genres) ? row.genres : []).filter(genre => typeof genre === 'string' && genre.toLowerCase() !== 'unknown').slice(0, 8).map(genre => `<span>${esc(genre)}</span>`).join('')}</div></div><span class="weekly-countdown"${row.airingAt ? ` data-airing="${Number(row.airingAt)}"` : ''}>${esc(airingCountdown(row.airingAt, now))}</span>`;
  return href ? `<a class="weekly-card" href="${esc(href)}">${body}</a>` : `<article class="weekly-card">${body}</article>`;
}

/** @param {import('./schedule.types.js').WeeklyScheduleRow[]} rows @param {string} selected @param {number} now */
export function weeklyTimelineHTML(rows, selected, now) {
  if (!rows.length) return '<li class="weekly-empty">Tidak ada episode untuk tanggal dan filter ini.</li>';
  const groups = new Map();
  const sorted = [...rows].sort((a, b) => (a.airingAt || Infinity) - (b.airingAt || Infinity));
  sorted.forEach((row, index) => {
    const key = row.airingAt || 'unknown-' + index;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  const current = weeklyTimeParts(now);
  const marker = `<li class="weekly-now"><time data-now-clock>${esc(current.time)}<small>${esc(current.period)}</small></time><span></span><b>NOW</b></li>`;
  let marked = false, html = '';
  for (const items of groups.values()) {
    const airingAt = items[0].airingAt;
    if (!marked && selected === localScheduleDate(new Date(now)) && (airingAt === null || airingAt * 1000 > now)) { html += marker; marked = true; }
    const time = airingAt ? weeklyTimeParts(airingAt * 1000) : { time: '--:--', period: '' };
    html += `<li class="weekly-group"><time class="weekly-airtime">${esc(time.time)}<small>${esc(time.period)}</small></time><span class="weekly-stem" aria-hidden="true"><i></i></span><div class="weekly-cards">${items.map(item => cardHTML(item, now)).join('')}</div></li>`;
  }
  if (!marked && selected === localScheduleDate(new Date(now))) html += marker;
  return html;
}
