import { isScheduleDate, localScheduleDate, scheduleLinks, scheduleTimezone, scheduleWeek, shiftScheduleDate } from './schedule-data.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

/** @param {string} selected @param {string} today */
export function scheduleDaysHTML(selected, today) {
  return scheduleWeek(selected).map(day => `<button class="schedule-day${day.date === selected ? ' selected' : ''}${day.date === today ? ' today' : ''}" type="button" data-date="${day.date}" aria-label="${escape(day.fullLabel)}" aria-pressed="${day.date === selected}"><span class="schedule-date">${escape(day.label)}</span><span class="schedule-weekday">${escape(day.weekday)}</span></button>`).join('');
}

/** @param {import('./schedule.types.js').ScheduleRow[]} rows */
export function scheduleRowsHTML(rows) {
  if (!rows.length) return '<p class="schedule-empty">Tidak ada jadwal untuk tanggal ini.</p>';
  return rows.map(row => {
    const links = scheduleLinks(row);
    const title = links.anime ? `<a class="sched-title" href="${links.anime}">${escape(row.title)}</a>` : `<span class="sched-title off" title="Detail anime belum tersedia">${escape(row.title)}</span>`;
    const episode = Number(row.episode_no);
    const label = Number.isFinite(episode) && episode > 0 ? 'Episode ' + episode : 'Detail';
    const button = links.episode ? `<a class="sched-ep" href="${escape(links.episode)}" aria-label="${escape(row.title + ' · ' + label)}"><span aria-hidden="true">▶</span>${escape(label)}</a>`
      : `<span class="sched-ep unavailable">${escape(label)}</span>`;
    return `<div class="sched-row"><time class="sched-time">${escape(row.time || '--:--')}</time>${title}${button}</div>`;
  }).join('');
}

/** Last selection wins, even when an old request finishes after a date change.
 * @param {{fetchDay: (date: string, timezone: number, signal: AbortSignal) => Promise<import('./schedule.types.js').ScheduleRow[]>, onData: (rows: import('./schedule.types.js').ScheduleRow[],date: string) => void, onError: (error: Error,date: string) => void}} options
 */
export function createScheduleLoader({ fetchDay, onData, onError }) {
  let active, pending, activeKey = '', sequence = 0;
  return {
    load(date, timezone) {
      const key = date + ':' + timezone;
      if (pending && key === activeKey) return pending;
      active?.abort();
      const request = new AbortController(), version = ++sequence;
      active = request; activeKey = key;
      pending = (async () => {
        try {
          const rows = await fetchDay(date, timezone, request.signal);
          if (request.signal.aborted || version !== sequence) return;
          if (!Array.isArray(rows)) throw new Error('Respons jadwal tidak valid.');
          onData(rows, date);
        } catch (error) { if (!request.signal.aborted && version === sequence) onError(error, date); }
        finally { if (version === sequence) { pending = null; activeKey = ''; } }
      })();
      return pending;
    },
    cancel() { sequence++; active?.abort(); activeKey = ''; pending = null; },
  };
}

/** @param {HTMLElement} root */
export function mountSchedule(root) {
  const days = root.querySelector('#schedDays'), list = root.querySelector('#schedList');
  const status = root.querySelector('#schedStatus'), retry = root.querySelector('#schedRetry');
  const clock = root.querySelector('#schedNow');
  let today = localScheduleDate(), selected = today, renderedDate = '', followingToday = true;
  let clockTimer, refreshTimer;
  const loader = createScheduleLoader({
    fetchDay: (date, timezone, signal) => apiGet('/catalog/schedule?' + new URLSearchParams({ date, tz: String(timezone) }), { signal }),
    onData(rows, date) {
      list.innerHTML = scheduleRowsHTML(rows);
      renderedDate = date;
      list.setAttribute('aria-busy', 'false');
      status.textContent = ''; status.hidden = true; retry.hidden = true;
    },
    onError(error, date) {
      list.setAttribute('aria-busy', 'false');
      if (renderedDate !== date) list.innerHTML = '<p class="schedule-empty">Jadwal belum dapat dimuat untuk tanggal ini.</p>';
      status.textContent = renderedDate === date ? 'Jadwal belum dapat diperbarui. Menampilkan data terakhir.' : 'Sumber jadwal sedang tidak tersedia. Silakan coba kembali.';
      status.hidden = false; retry.hidden = false;
    },
  });
  function paint() {
    days.innerHTML = scheduleDaysHTML(selected, today);
    list.setAttribute('aria-label', 'Jadwal ' + selected);
  }
  function refresh() {
    if (document.hidden) return;
    if (renderedDate !== selected) list.innerHTML = '<p class="schedule-empty">Memuat jadwal…</p>';
    list.setAttribute('aria-busy', 'true');
    void loader.load(selected, scheduleTimezone(selected));
  }
  function select(date, focus = false) {
    if (!isScheduleDate(date)) return;
    selected = date; followingToday = date === today;
    status.hidden = true; retry.hidden = true;
    paint(); refresh();
    if (focus) days.querySelector(`[data-date="${selected}"]`)?.focus({ preventScroll: true });
  }
  function tick() {
    if (document.hidden) return;
    const date = localScheduleDate();
    if (date !== today) { today = date; if (followingToday) select(today); else paint(); }
    const now = new Date();
    clock.textContent = '– Now: ' + now.toLocaleString('en-US') + ' · ' + new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(now).find(part => part.type === 'timeZoneName').value;
  }
  days.onclick = event => {
    const button = event.target.closest('button[data-date]');
    if (button) select(button.dataset.date, true);
  };
  days.onkeydown = event => {
    const offset = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (offset) { event.preventDefault(); select(shiftScheduleDate(selected, offset), true); }
    else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); select(scheduleWeek(selected)[event.key === 'Home' ? 0 : 6].date, true);
    }
  };
  root.querySelector('#schedPrev').onclick = () => select(shiftScheduleDate(selected, -7));
  root.querySelector('#schedNext').onclick = () => select(shiftScheduleDate(selected, 7));
  retry.onclick = refresh;
  const start = () => { clearInterval(clockTimer); clearInterval(refreshTimer); tick(); refresh(); clockTimer = setInterval(tick, 1000); refreshTimer = setInterval(refresh, 60_000); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) loader.cancel(); else { tick(); refresh(); } });
  window.addEventListener('pagehide', () => { loader.cancel(); clearInterval(clockTimer); clearInterval(refreshTimer); });
  window.addEventListener('pageshow', event => { if (event.persisted) start(); });
  paint(); start();
}
