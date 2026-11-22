const safeSlug = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,239}$/i.test(value);
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
    History: '<path d="M3 4v6h6M3 10a9 9 0 1 1 1 8M12 7v5l3 2"/>',
  };
  for (const [label, href] of [['Home','/home'],['Trending','/browse?source=trending'],['Browse','/browse'],['Schedule','/schedule'],['History','/history'],['Account','/account']]) {
    const anchor = link(href, '', 'miruro-rail-link'); anchor.title = label; anchor.setAttribute('aria-label', label);
    anchor.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">${icons[label]}</svg>`;
    if (location.pathname === href) anchor.setAttribute('aria-current', 'page'); nav.append(anchor);
  }
  document.body.prepend(nav);
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
  mountRail(); void mountUpcoming(); void mountInfoExtras();
  const watchSlug = /^\/watch\/([a-z0-9_-]+)(?:\/|$)/i.exec(location.pathname)?.[1];
  if (watchSlug) apiGet('/catalog/anime/' + encodeURIComponent(watchSlug)).then(setBackdrop).catch(() => {});
  const heading = document.getElementById('rankingHeading');
  if (heading) heading.textContent = 'Top Airing';
  const periods = document.getElementById('topTabs');
  if (periods) periods.hidden = true;
}
