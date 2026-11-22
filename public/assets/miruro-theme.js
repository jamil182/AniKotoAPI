const historyKey = 'aniyear:continue-watching:v1';
const safeSlug = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,239}$/i.test(value);
/** @returns {Array<{slug: string, episode: number, title: string, poster: string, time: number, duration: number, updated: number}>} */
function historyRows() {
  try {
    const rows = JSON.parse(localStorage.getItem(historyKey) || '[]');
    return Array.isArray(rows) ? rows.filter(row => safeSlug(row.slug) && Number.isFinite(row.episode) && row.episode > 0 && Number.isFinite(row.time) && Number.isFinite(row.duration) && row.time >= 0 && row.duration > 0).slice(0, 30) : [];
  } catch { return []; }
}
/** @param {unknown} value */
function picture(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : '/favicon.svg'; } catch { return '/favicon.svg'; }
}
function link(href, text, className = '') { const node = document.createElement('a'); node.href = href; node.textContent = text; node.className = className; return node; }

function mountRail() {
  if (document.getElementById('miruroRail')) return;
  const nav = document.createElement('nav'); nav.id = 'miruroRail'; nav.className = 'miruro-rail'; nav.setAttribute('aria-label', 'Quick navigation');
  const icons = {
    Home: '<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z"/>',
    Trending: '<path d="M13 3c1 7-5 6-2 11-4-1-4-4-4-4-7 11 12 17 13 4 0-5-4-8-7-11Z"/>',
    Browse: '<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5Z"/>',
    Schedule: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18"/>',
    Account: '<circle cx="12" cy="7" r="4"/><path d="M4 22v-4a8 8 0 0 1 16 0v4"/>',
  };
  for (const [label, href] of [['Home','/home'],['Trending','/browse?source=trending'],['Browse','/browse'],['Schedule','/schedule'],['Account','/account']]) {
    const anchor = link(href, '', 'miruro-rail-link'); anchor.title = label; anchor.setAttribute('aria-label', label);
    anchor.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">${icons[label]}</svg>`;
    if (location.pathname === href) anchor.setAttribute('aria-current', 'page'); nav.append(anchor);
  }
  document.body.prepend(nav);
}

function mountContinueWatching() {
  const main = document.querySelector('.main.wrap-home'); if (!main) return;
  const rows = historyRows().filter(row => row.time > 5 && row.time < row.duration - 30).slice(0, 5);
  if (!rows.length) return;
  const section = document.createElement('section'); section.className = 'miruro-continue wrap wrap-home'; section.id = 'continueWatching';
  const heading = document.createElement('h2'); heading.className = 'section-title'; heading.textContent = 'Continue Watching'; section.append(heading);
  const grid = document.createElement('div'); grid.className = 'continue-grid';
  for (const row of rows) {
    const anchor = link(`/watch/${encodeURIComponent(row.slug)}/${row.episode}`, '', 'continue-card');
    const image = document.createElement('img'); image.src = picture(row.poster); image.alt = ''; image.loading = 'lazy';
    const progress = document.createElement('progress'); progress.max = row.duration; progress.value = row.time; progress.setAttribute('aria-label', 'Watch progress');
    const title = document.createElement('strong'); title.textContent = row.title;
    const episode = document.createElement('small'); episode.textContent = `Episode ${row.episode}`;
    anchor.append(image, progress, title, episode); grid.append(anchor);
  }
  section.append(grid); main.before(section);
}

function recordWatchProgress() {
  const match = /^\/watch\/([a-z0-9_-]+)\/(\d+(?:\.\d+)?)\/?$/i.exec(location.pathname), video = document.getElementById('video');
  if (!match || !(video instanceof HTMLVideoElement)) return;
  const slug = match[1], episode = Number(match[2]); let anime = null, lastSaved = 0, restored = false;
  apiGet('/catalog/anime/' + encodeURIComponent(slug)).then(value => { anime = value; setBackdrop(value); }).catch(() => {});
  const save = (force = false) => {
    if (!anime || !Number.isFinite(video.duration) || video.duration < 30 || video.currentTime < 1 || (!force && Date.now() - lastSaved < 10000)) return;
    lastSaved = Date.now();
    const rows = historyRows().filter(row => row.slug !== slug);
    rows.unshift({ slug, episode, title: String(anime.title).slice(0, 300), poster: picture(anime.poster), time: video.currentTime, duration: video.duration, updated: lastSaved });
    try { localStorage.setItem(historyKey, JSON.stringify(rows.slice(0, 30))); } catch { /* Playback also works when browser storage is full or disabled. */ }
  };
  video.addEventListener('loadedmetadata', () => {
    if (restored) return; restored = true;
    const saved = historyRows().find(row => row.slug === slug && row.episode === episode);
    if (saved && saved.time > 5 && saved.time < video.duration - 30) video.currentTime = saved.time;
  });
  video.addEventListener('timeupdate', () => save()); video.addEventListener('pause', () => save(true));
  window.addEventListener('pagehide', () => save(true));
}
function setBackdrop(anime) {
  const url = picture(anime.backgroundImage || anime.poster);
  document.body.style.setProperty('--anime-backdrop', `url("${url}")`); document.body.classList.add('miruro-anime-backdrop');
}

async function mountUpcoming() {
  const aside = document.querySelector('.main.wrap-home > aside'); if (!aside) return;
  try {
    const home = await apiGet('/catalog/home');
    const rows = Array.isArray(home.upcoming) ? home.upcoming.slice(0, 5) : [];
    if (!rows.length) return;
    const section = document.createElement('section'); section.className = 'miruro-upcoming';
    const title = document.createElement('h2'); title.className = 'section-title'; title.textContent = 'Upcoming'; section.append(title);
    for (const row of rows) {
      if (!safeSlug(row.slug)) continue;
      const anchor = link('/anime/' + encodeURIComponent(row.slug), '', 'miruro-side-card');
      const image = document.createElement('img'); image.src = picture(row.poster); image.alt = ''; image.loading = 'lazy';
      const copy = document.createElement('div'), name = document.createElement('strong'), detail = document.createElement('small');
      name.textContent = row.title; detail.textContent = [row.type, row.year].filter(Boolean).join(' · '); copy.append(name, detail); anchor.append(image, copy); section.append(anchor);
    }
    aside.append(section);
  } catch { /* The ranking and catalog remain usable independently. */ }
}

async function mountInfoExtras() {
  const match = /^\/anime\/([a-z0-9_-]+)\/?$/i.exec(location.pathname); if (!match) return;
  try {
    const anime = await apiGet('/catalog/anime/' + encodeURIComponent(match[1])); setBackdrop(anime);
    const host = document.createElement('div'); host.className = 'wrap miruro-info-extras';
    const actions = document.createElement('div'); actions.className = 'miruro-info-actions'; actions.append(link(`/watch/${encodeURIComponent(match[1])}/1`, '▶ Watch Now', 'btn primary')); host.append(actions);
    for (const [label, rows] of [['Related', anime.related], ['More like this', anime.recommended]]) {
      if (!Array.isArray(rows) || !rows.length) continue;
      const section = document.createElement('section'); section.className = 'section';
      const title = document.createElement('h2'); title.className = 'section-title'; title.textContent = label;
      const strip = document.createElement('div'); strip.className = 'miruro-poster-strip';
      for (const row of rows.slice(0, 12)) {
        if (!safeSlug(row.slug)) continue;
        const anchor = link('/anime/' + encodeURIComponent(row.slug), '', 'miruro-poster-card'), image = document.createElement('img');
        image.src = picture(row.poster); image.alt = ''; image.loading = 'lazy'; const name = document.createElement('strong'); name.textContent = row.title; anchor.append(image, name); strip.append(anchor);
      }
      section.append(title, strip); host.append(section);
    }
    if (Array.isArray(anime.characters) && anime.characters.length) {
      const section = document.createElement('section'); section.className = 'section';
      const title = document.createElement('h2'); title.className = 'section-title'; title.textContent = 'Characters & Voice Actors';
      const grid = document.createElement('div'); grid.className = 'miruro-characters';
      for (const character of anime.characters) {
        const person = character.node || character; if (!person.name?.full) continue;
        const row = document.createElement('div'); row.className = 'miruro-character';
        const image = document.createElement('img'); image.src = picture(person.image?.large); image.alt = ''; image.loading = 'lazy';
        const name = document.createElement('strong'); name.textContent = person.name.full;
        const actor = character.voiceActors?.[0];
        row.append(image, name);
        if (actor?.name?.full) {
          const label = document.createElement('span'); label.textContent = actor.name.full;
          const avatar = document.createElement('img'); avatar.src = picture(actor.image?.large); avatar.alt = ''; avatar.loading = 'lazy'; row.append(label, avatar);
        }
        grid.append(row);
      }
      section.append(title, grid); host.append(section);
    }
    document.getElementById('comments')?.before(host);
  } catch { /* The existing details page supplies its own retry control. */ }
}

export async function mountProviderTheme() {
  if (/^\/admin(?:\/|$)/.test(location.pathname)) return;
  const config = await apiGet('/site-config');
  if (config.theme !== 'miruro') return;
  document.documentElement.dataset.siteTheme = 'miruro';
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/assets/miruro-theme.css?v=1'; document.head.append(css);
  mountRail(); mountContinueWatching(); recordWatchProgress(); void mountUpcoming(); void mountInfoExtras();
  const heading = document.getElementById('rankingHeading');
  if (heading) heading.textContent = 'Top Airing';
  const periods = document.getElementById('topTabs');
  if (periods) periods.hidden = true;
}
