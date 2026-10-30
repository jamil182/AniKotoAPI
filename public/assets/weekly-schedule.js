import { isScheduleDate, localScheduleDate, scheduleWeek, scheduleTimezone, shiftScheduleDate } from './schedule-data.js';
import { createScheduleLoader } from './schedule-page.js?v=1';
import { airingCountdown, filterWeeklyRows, isWeeklySchedule, weeklyDaysHTML, weeklyTimelineHTML, weeklyTimeParts } from './weekly-schedule-view.js';

/** @param {HTMLElement} root */
export function mountWeeklySchedule(root) {
  const days = root.querySelector('#weeklyDays'), timeline = root.querySelector('#weeklyTimeline');
  const status = root.querySelector('#weeklyStatus'), retry = root.querySelector('#weeklyRetry');
  const summary = root.querySelector('#weeklySummary'), range = root.querySelector('#weeklyRange');
  const clock = root.querySelector('#weeklyClock'), live = document.getElementById('liveStatus');
  /** @type {Map<string, {rows: import('./schedule.types.js').WeeklyScheduleRow[], at: number}>} */
  const cache = new Map();
  let selected = localScheduleDate(), language = 'all', today = selected, renderedDate = '';
  /** @type {import('./schedule.types.js').WeeklyScheduleRow[]} */
  let rows = [];
  let weekRequest, clockTimer, refreshTimer, nextBoundary = Infinity;
  const dateLabel = date => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z')).replace(',', '');
  const fetchDay = async (date, timezone, signal) => {
    const data = await apiGet('/catalog/weekly-schedule?' + new URLSearchParams({ date, tz: String(timezone) }), { signal });
    if (!isWeeklySchedule(data)) throw new Error('Respons Weekly Schedule tidak valid.');
    return data;
  };
  function store(date, data) {
    cache.delete(date);
    if (cache.size >= 21) cache.delete(cache.keys().next().value);
    cache.set(date, { rows: data, at: Date.now() });
  }
  function paintDays() {
    const focused = days.contains(document.activeElement) ? document.activeElement.dataset.date : null;
    days.innerHTML = weeklyDaysHTML(selected, today, cache, language);
    if (focused) days.querySelector(`[data-date="${focused}"]`)?.focus({ preventScroll: true });
    const week = scheduleWeek(selected);
    range.textContent = `${dateLabel(week[0].date)} – ${dateLabel(week[6].date)} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
    for (const button of root.querySelectorAll('[data-language]')) button.setAttribute('aria-pressed', String(button.dataset.language === language));
  }
  function paintTimeline() {
    const visible = filterWeeklyRows(rows, language), now = Date.now();
    timeline.innerHTML = weeklyTimelineHTML(visible, selected, now);
    timeline.setAttribute('aria-label', dateLabel(selected) + ' anime episodes');
    summary.textContent = `${dateLabel(selected)} · ${visible.length} episodes`;
    const future = visible.map(row => row.airingAt * 1000).filter(time => time > now);
    nextBoundary = selected === today && future.length ? Math.min(...future) : Infinity;
  }
  const loader = createScheduleLoader({ fetchDay,
    onData(data, date) {
      store(date, data); rows = data; renderedDate = date;
      status.hidden = true; retry.hidden = true; timeline.setAttribute('aria-busy', 'false');
      paintDays(); paintTimeline();
      if (live) { live.textContent = 'Live · ' + new Date().toLocaleTimeString(); live.dataset.state = 'live'; }
    },
    onError(error, date) {
      timeline.setAttribute('aria-busy', 'false');
      if (renderedDate !== date) timeline.innerHTML = '<li class="weekly-empty">Jadwal belum dapat dimuat untuk tanggal ini.</li>';
      status.textContent = renderedDate === date ? 'Menampilkan jadwal terakhir. Pembaruan akan dicoba kembali.' : 'Sumber jadwal sedang tidak tersedia. Silakan coba lagi.';
      status.hidden = false; retry.hidden = false;
      if (live) { live.textContent = 'Schedule unavailable · retrying'; live.dataset.state = 'stale'; }
    },
  });
  function refresh(force = false) {
    if (document.hidden) return;
    const hit = cache.get(selected);
    if (!force && hit && Date.now() - hit.at < 60_000) {
      rows = hit.rows; renderedDate = selected; paintDays(); paintTimeline();
      timeline.setAttribute('aria-busy', 'false'); status.hidden = true; retry.hidden = true;
      if (live) { live.textContent = 'Live · ' + new Date(hit.at).toLocaleTimeString(); live.dataset.state = 'live'; }
      loader.cancel(); return;
    }
    if (renderedDate !== selected) { timeline.innerHTML = '<li class="weekly-empty">Memuat jadwal…</li>'; summary.textContent = dateLabel(selected); }
    timeline.setAttribute('aria-busy', 'true');
    void loader.load(selected, scheduleTimezone(selected));
  }
  async function warmWeek() {
    weekRequest?.abort();
    if (document.hidden) return;
    const request = new AbortController(); weekRequest = request;
    const dates = scheduleWeek(selected).map(day => day.date).filter(date => date !== selected && (!cache.has(date) || Date.now() - cache.get(date).at >= 60_000));
    let cursor = 0;
    const worker = async () => {
      while (!request.signal.aborted && cursor < dates.length) {
        const date = dates[cursor++];
        try {
          const data = await fetchDay(date, scheduleTimezone(date), request.signal);
          if (request.signal.aborted) return;
          if (!Array.isArray(data)) continue;
          store(date, data); paintDays();
        } catch { /* Unknown day counts remain blank; the selected day has its own retry. */ }
      }
    };
    await Promise.allSettled([worker(), worker()]);
  }
  function saveLocation() {
    const url = new URL(location.href);
    url.searchParams.set('date', selected); url.searchParams.set('lang', language);
    history.replaceState(null, '', url.pathname + url.search);
  }
  function select(date, focus = false) {
    if (!isScheduleDate(date)) return;
    selected = date; status.hidden = true; retry.hidden = true;
    saveLocation(); paintDays(); refresh(); void warmWeek();
    if (focus) days.querySelector(`[data-date="${selected}"]`)?.focus({ preventScroll: true });
  }
  function restore() {
    const query = new URLSearchParams(location.search);
    selected = isScheduleDate(query.get('date')) ? query.get('date') : localScheduleDate();
    language = ['sub', 'dub'].includes(query.get('lang')) ? query.get('lang') : 'all';
    paintDays(); refresh(); void warmWeek();
  }
  function tick() {
    if (document.hidden) return;
    const now = Date.now(), date = localScheduleDate();
    if (date !== today) {
      const wasToday = selected === today; today = date;
      if (wasToday) select(today); else { paintDays(); paintTimeline(); }
    }
    const current = weeklyTimeParts(now, true);
    clock.textContent = current.time + ' ' + current.period; clock.dateTime = new Date(now).toISOString();
    if (now >= nextBoundary) paintTimeline();
    for (const element of timeline.querySelectorAll('[data-airing]')) element.textContent = airingCountdown(Number(element.dataset.airing), now);
    const nowClock = timeline.querySelector('[data-now-clock]');
    if (nowClock) {
      const parts = weeklyTimeParts(now), period = document.createElement('small'); period.textContent = parts.period;
      nowClock.replaceChildren(document.createTextNode(parts.time), period);
    }
  }
  days.onclick = event => { const button = event.target.closest('button[data-date]'); if (button) select(button.dataset.date, true); };
  days.onkeydown = event => {
    const offset = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (offset) { event.preventDefault(); select(shiftScheduleDate(selected, offset), true); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); select(scheduleWeek(selected)[event.key === 'Home' ? 0 : 6].date, true); }
  };
  root.querySelector('#weeklyPrev').onclick = () => select(shiftScheduleDate(selected, -7));
  root.querySelector('#weeklyNext').onclick = () => select(shiftScheduleDate(selected, 7));
  for (const button of root.querySelectorAll('[data-language]')) button.onclick = () => {
    language = button.dataset.language; saveLocation(); paintDays();
    if (renderedDate === selected) paintTimeline();
  };
  retry.onclick = () => { refresh(true); void warmWeek(); };
  const stop = () => { loader.cancel(); weekRequest?.abort(); clearInterval(clockTimer); clearInterval(refreshTimer); };
  const start = () => {
    clearInterval(clockTimer); clearInterval(refreshTimer); tick();
    clockTimer = setInterval(tick, 1000);
    refreshTimer = setInterval(() => { refresh(true); void warmWeek(); }, 60_000);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { loader.cancel(); weekRequest?.abort(); if (live) { live.textContent = 'Paused'; live.dataset.state = 'paused'; } }
    else { tick(); refresh(true); void warmWeek(); }
  });
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', event => { if (event.persisted) { start(); refresh(true); void warmWeek(); } });
  window.addEventListener('popstate', restore);
  restore(); start();
}

if (typeof document !== 'undefined') {
  mountNav('schedule');
  const az = document.getElementById('weeklyAz');
  for (const letter of ['All', '#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']) {
    const link = document.createElement('a');
    link.href = letter === 'All' ? '/browse' : '/browse?letter=' + (letter === '#' ? '0' : letter.toLowerCase());
    link.textContent = letter; az.append(link);
  }
  mountWeeklySchedule(document.getElementById('weeklySchedule'));
}
