/** @typedef {import('../../src/services/visitors.types.js').VisitorStats} VisitorStats */
const number = value => Number(value).toLocaleString('id-ID');
const time = value => new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'medium' });

/** @param {Document} page @param {VisitorStats} stats */
export function renderVisitorStats(page, stats) {
  const set = (id, value) => { page.getElementById(id).textContent = value; };
  set('visitorsOnline', number(stats.online));
  set('visitorsToday', number(stats.today.visitors));
  set('visitorsVisits', number(stats.totals.visits));
  set('visitorsViews', number(stats.totals.pageviews));
  set('visitorsUpdated', `Diperbarui ${time(stats.generatedAt)} WIB · Mulai dicatat ${time(stats.startedAt)} WIB`);
  set('visitorsPage', `${number(stats.total)} pengunjung dalam 30 hari · Halaman ${stats.page} / ${stats.pages}`);
  page.getElementById('visitorsPrev').disabled = stats.page <= 1;
  page.getElementById('visitorsNext').disabled = stats.page >= stats.pages;
  const row = values => {
    const element = page.createElement('tr');
    for (const value of values) {
      const cell = page.createElement('td');
      cell.textContent = value;
      element.append(cell);
    }
    return element;
  };
  const rows = stats.visitors.map(visitor => {
    const location = visitor.status === 'local' ? 'Jaringan lokal' : [visitor.city, visitor.region, visitor.country].filter(Boolean).join(', ') || (visitor.status === 'disabled' ? 'Lookup dinonaktifkan' : 'Lokasi belum tersedia');
    const element = row([visitor.online ? '● Online' : 'Offline', visitor.ip, location, visitor.path, number(visitor.views), `${time(visitor.lastSeen)} WIB`]);
    element.firstElementChild.className = visitor.online ? 'visitor-online' : 'cms-muted';
    return element;
  });
  if (!rows.length) {
    const empty = row(['Belum ada kunjungan. Statistik mulai terisi saat pengunjung membuka website.']);
    empty.firstElementChild.colSpan = 6;
    rows.push(empty);
  }
  page.getElementById('visitorsRows').replaceChildren(...rows);
  page.getElementById('visitorsDaily').replaceChildren(...stats.daily.map(day => row([day.day, number(day.visitors), number(day.visits), number(day.pageviews)])));
}

/** @param {{request: (path: string) => Promise<VisitorStats>}} client
 * @param {() => void} unauthorized
 */
export function createAdminVisitors(client, unauthorized) {
  let timer, active = false, busy = false, version = 0, currentPage = 1;
  const errorBox = document.getElementById('visitorsError');
  async function refresh() {
    if (!active || document.hidden || busy) return;
    const current = version;
    busy = true;
    try {
      const stats = await client.request('/visitors?page=' + currentPage);
      if (!active || current !== version) return;
      currentPage = stats.page;
      renderVisitorStats(document, stats);
      errorBox.textContent = '';
    } catch (error) {
      if (!active || current !== version) return;
      errorBox.textContent = 'Statistik belum dapat diperbarui. Mencoba lagi secara otomatis.';
      if (error.status === 401) unauthorized();
    } finally { busy = false; }
  }
  document.getElementById('visitorsRefresh').onclick = () => void refresh();
  document.getElementById('visitorsPrev').onclick = () => { if (!busy && currentPage > 1) { currentPage--; void refresh(); } };
  document.getElementById('visitorsNext').onclick = () => { if (!busy) { currentPage++; void refresh(); } };
  document.addEventListener('visibilitychange', () => void refresh());
  return {
    start() { active = true; version++; clearInterval(timer); void refresh(); timer = setInterval(refresh, 15_000); },
    stop() {
      active = false; version++; clearInterval(timer);
      document.getElementById('visitorsRows').replaceChildren();
      document.getElementById('visitorsDaily').replaceChildren();
      for (const id of ['visitorsOnline', 'visitorsToday', 'visitorsVisits', 'visitorsViews']) document.getElementById(id).textContent = '—';
    },
  };
}
