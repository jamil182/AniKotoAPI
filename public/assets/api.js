/*
 * AniJs — api.js
 * Small shared client for the AniJs frontend: same-origin API calls plus
 * the card/skeleton renderers reused across pages.
 */

// API base = same origin the page is served from, so a local instance talks
// to itself and a deployment talks to itself. Falls back to the public API
// only when opened from disk (file://), where there is no origin.
const API = location.protocol.startsWith('http')
  ? location.origin + '/api'
  : 'https://anikototvapi.vercel.app/api';

async function apiGet(path, { signal } = {}) {
  const timeout = AbortSignal.timeout(25000);
  const res = await fetch(API + path, {
    cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.message || 'HTTP ' + res.status);
    error.retryAfter = Number(res.headers.get('Retry-After')) || 0;
    throw error;
  }
  const data = await res.json();
  if (data && data.success === false) throw new Error(data.message || 'Request failed');
  return data.results;
}

// ---- Small view helpers ----
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Some catalogue fields arrive already HTML-encoded (episode titles carry
// &#39; for an apostrophe). Escaping those again renders the entity as
// literal text, so decode first. A detached textarea decodes text only --
// nothing in it is parsed as markup or executed.
const decodeEntities = (s) => {
  const t = document.createElement('textarea');
  t.innerHTML = String(s ?? '');
  return t.value;
};

// Episode suffixes are omitted from anime detail URLs.
const animeSlug = (slug) => String(slug || '').split('/')[0];

function subDubChips(item) {
  let h = '';
  if (item.sub) h += `<span class="chip sub">SUB ${item.sub}</span>`;
  if (item.dub) h += `<span class="chip dub">DUB ${item.dub}</span>`;
  return h;
}

// Durations arrive as "25m", "24 min" or a bare "12". Normalise to one form
// so the hover card does not read like three different fields.
function fmtDuration(v) {
  if (!v) return '';
  const n = String(v).match(/[0-9]+/);
  return n ? esc(n[0] + ' min') : esc(String(v));
}
// ---- Poster hover card ----
// Every field here is already in memory from /catalog/home, so hovering costs
// no request. Rows whose data is missing are dropped rather than printed
// empty: duration in particular is absent for a third of the catalogue.
function cardTipHTML(item) {
  const row = (label, value) =>
    value ? `<div class="tip-row"><span class="tip-k">${label}:</span> ${value}</div>` : '';
  const list = Array.isArray(item.genres)
    ? item.genres
    : (item.genres ? String(item.genres).split(',') : []);
  const genres = list.slice(0, 6)
    .map((g) => `<span class="tip-genre">${esc(String(g).trim())}</span>`).join('');

  return `
    <div class="card-tip">
      <div class="tip-title">${esc(item.title || item.name || 'Untitled')}</div>
      <div class="tip-badges">${subDubChips(item)}${item.type ? `<span class="card-type tip-type">${esc(item.type)}</span>` : ''}</div>
      ${item.synopsis ? `<p class="tip-syn">${esc(item.synopsis)}</p>` : ''}
      ${row('Other names', item.japanese_title ? esc(item.japanese_title) : '')}
      ${row('Scores', item.rating ? esc(item.rating) : '')}
      ${row('Year', item.year ? esc(item.year) : '')}
      ${row('Duration', fmtDuration(item.duration))}
      ${row('Status', item.status ? esc(item.status) : '')}
      ${genres ? `<div class="tip-row"><span class="tip-k">Genre:</span> ${genres}</div>` : ''}
      <a class="tip-watch" href="/watch/${encodeURIComponent(item.id)}/1"
         onclick="event.stopPropagation()">&#9654; Watch</a>
    </div>`;
}

// Flip the card away from whichever edge it would otherwise run past. Measured
// on hover because the grid reflows with the window.
document.addEventListener('mouseover', (e) => {
  const card = e.target.closest && e.target.closest('.card');
  if (!card) return;
  const tip = card.querySelector('.card-tip');
  if (!tip) return;
  const r = card.getBoundingClientRect();
  const w = tip.offsetWidth || 300;
  tip.classList.toggle('flip', r.right + w + 14 > window.innerWidth);
  // Keep it on screen vertically too, without letting it cover the poster.
  const over = r.top + tip.offsetHeight - (window.innerHeight - 12);
  tip.style.top = over > 0 ? (-Math.min(over, r.top - 12)) + 'px' : '0px';
});

function cardHTML(item, progressHTML = '') {
  const title = item.title || item.name || 'Untitled';
  return `
    <div class="card" data-id="${esc(item.id)}">
      <div class="card-poster">
        <img loading="lazy" src="${esc(item.poster || '/favicon.svg')}" alt="${esc(title)}"
             onerror="this.style.visibility='hidden'">
        ${progressHTML}
      </div>
      <div class="card-title">${esc(title)}</div>
      ${item.rating ? `<div class="card-sub">★ ${esc(item.rating)}</div>` : ''}
      ${cardTipHTML(item)}
    </div>`;
}

function skeletonCards(n) {
  return Array.from({ length: n }, () => '<div class="skeleton sk-card"></div>').join('');
}

// Render into `el`: run loader(), draw cards; on failure show a retry that
// re-runs the same loader. Each section degrades on its own.
async function renderCards(el, loader, { count = 12, empty = 'Nothing here yet.' } = {}) {
  el.innerHTML = `<div class="grid">${skeletonCards(count)}</div>`;
  try {
    const items = await loader();
    if (!items || !items.length) { el.innerHTML = `<div class="state">${empty}</div>`; return; }
    const { cardProgressHTML } = await import('/assets/card-progress.js');
    el.innerHTML = `<div class="grid">${items.slice(0, count).map(item => cardHTML(item, cardProgressHTML(item))).join('')}</div>`;
  } catch (e) {
    el.innerHTML = `<div class="state">Couldn't load this section (${esc(e.message)}).<br><button>Retry</button></div>`;
    el.querySelector('button').onclick = () => renderCards(el, loader, { count, empty });
  }
}

// ---- Navigation ----
// Catalog identifiers are AniKoto slugs, including search and ranking results.
const animeHref = (id) => '/anime/' + encodeURIComponent(id);

// Any element carrying a non-empty data-id navigates to that anime's detail
// page. One delegated listener covers cards, ranking rows, and search results,
// on every page, without per-element wiring.
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-id]');
  if (el && el.dataset.id) location.href = animeHref(el.dataset.id);
});

// ---- Shared nav ----
// Markup + behaviour for the top bar, so the home and detail pages share one
// implementation. `active` dims the matching nav link.
function navHTML(active) {
  const on = (k) => active === k ? ' style="color:var(--ink)"' : '';
  return `
    <div class="wrap nav-inner">
      <div class="nav-brand">
        <button type="button" class="nav-menu-toggle" id="navMenuToggle" aria-label="Open menu" aria-controls="siteMenu" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path class="menu-bars" d="M3 5h18M3 12h18M3 19h18"/><path class="menu-close" d="m5 5 14 14M5 19 19 5"/></svg></button>
        <a href="/home" class="logo" aria-label="AniJs home"><img src="/logo.png" alt="AniJs" width="132" height="34" decoding="async"></a>
      </div>
      <div class="nav-search">
        <input id="navSearch" type="text" placeholder="Search anime…" autocomplete="off" />
        <div class="search-drop" id="navSearchDrop"></div>
      </div>
      <nav class="nav-links">
        <span id="liveStatus" class="live-status" role="status" aria-live="polite">Connecting…</span>
        <a class="nav-btn nav-weekly" href="/schedule" aria-label="Weekly Schedule" title="Weekly Schedule"${active === 'schedule' ? ' aria-current="page"' : ''}${on('schedule')}><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18m-14 4h3m4 0h3m-10 3h3m4 0h3"/></svg><span>Weekly Schedule</span></a>
        <button class="nav-btn" id="navRandom">Random</button>
        <span class="nav-account" id="navAccount">
          <a class="nav-btn" href="/login"${on('login')}>Login</a>
          <a class="nav-btn solid" href="/register"${on('register')}>Register</a>
        </span>
      </nav>
    </div>`;
}

function wireNav() {
  const input = document.getElementById('navSearch');
  const drop = document.getElementById('navSearchDrop');
  let timer = null;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { drop.classList.remove('open'); return; }
    timer = setTimeout(async () => {
      try {
        const r = await apiGet('/catalog/search?keyword=' + encodeURIComponent(q));
        if (input.value.trim() !== q) return;
        const items = (r.data || []).slice(0, 6);
        drop.innerHTML = items.length
          ? items.map(it => `
              <div class="search-row" data-id="${esc(it.id)}">
                <img loading="lazy" src="${esc(it.poster)}" alt="" onerror="this.style.visibility='hidden'">
                <div>
                  <div class="t">${esc(it.title)}</div>
                  <div class="m">${esc(it.type || 'Anime')}${it.rating ? ' · ★ ' + esc(it.rating) : ''}</div>
                </div>
              </div>`).join('')
          : '<div class="search-empty">No matches.</div>';
        drop.classList.add('open');
      } catch (e) {
        if (input.value.trim() !== q) return;
        drop.innerHTML = `<div class="search-empty">Search failed: ${esc(e.message)}</div>`;
        drop.classList.add('open');
      }
    }, 280);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-search')) drop.classList.remove('open');
  });

  document.getElementById('navRandom').onclick = async (e) => {
    const btn = e.target; const old = btn.textContent; btn.textContent = '…'; btn.disabled = true;
    try {
      const anime = await apiGet('/catalog/random');
      location.href = animeHref(anime.id);
    } catch (error) {
      drop.innerHTML = `<div class="search-empty">${esc(error.message)}</div>`;
      drop.classList.add('open');
    }
    finally { btn.textContent = old; btn.disabled = false; }
  };
}

// Inject the nav into a <header id="nav"> and wire it. Both pages call this.
function mountNav(active) {
  const host = document.getElementById('nav');
  if (!host) return;
  host.className = 'nav';
  host.innerHTML = navHTML(active);
  wireNav();
  import('/assets/site-menu.js?v=weekly-1').then(module => module.mountSiteMenu(host)).catch(() => {});
  import('/assets/account-nav.js').then(module => module.mountAccountNav(document.getElementById('navAccount'))).catch(() => {});
}
