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

async function apiGet(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error('HTTP ' + res.status);
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

// The API returns some slugs with an episode suffix (".../ep-1"). Trim it so a
// slug reads as the anime, ready for the detail route wired up in a later phase.
const animeSlug = (slug) => String(slug || '').split('/')[0];

function subDubChips(item) {
  let h = '';
  if (item.sub) h += `<span class="chip sub">SUB ${item.sub}</span>`;
  if (item.dub) h += `<span class="chip dub">DUB ${item.dub}</span>`;
  return h;
}

// Poster card. Non-navigating in this phase: it carries the slug on a data
// attribute so a later phase can turn it into a link without markup changes.
// Durations arrive as "25m", "24 min" or a bare "12". Normalise to one form
// so the hover card does not read like three different fields.
function fmtDuration(v) {
  if (!v) return '';
  const n = String(v).match(/[0-9]+/);
  return n ? esc(n[0] + ' min') : esc(String(v));
}
// ---- Poster hover card ----
// Every field here is already in memory from /library/home, so hovering costs
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

function cardHTML(item) {
  const title = item.title || item.name || 'Untitled';
  const type = item.type || '';
  return `
    <div class="card" data-id="${esc(item.id)}">
      <div class="card-poster">
        <img loading="lazy" src="${esc(item.poster || '/favicon.svg')}" alt="${esc(title)}"
             onerror="this.style.visibility='hidden'">
        <div class="card-badges">${subDubChips(item)}</div>
        ${type ? `<span class="card-type">${esc(type)}</span>` : ''}
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
    el.innerHTML = `<div class="grid">${items.slice(0, count).map(cardHTML).join('')}</div>`;
  } catch (e) {
    el.innerHTML = `<div class="state">Couldn't load this section (${esc(e.message)}).<br><button>Retry</button></div>`;
    el.querySelector('button').onclick = () => renderCards(el, loader, { count, empty });
  }
}

// ---- Navigation ----
// The frontend is library-backed: anime are addressed by their internal
// library id (mixed-source — MAL entries have no slug), so navigation is by id.
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
      <a href="/home" class="logo">Ani<b>Js</b></a>
      <div class="nav-search">
        <input id="navSearch" type="text" placeholder="Search anime…" autocomplete="off" />
        <div class="search-drop" id="navSearchDrop"></div>
      </div>
      <nav class="nav-links">
        <button class="nav-btn" id="navRandom">Random</button>
        <a class="nav-btn" href="/docs"${on('docs')}>API Docs</a>
        <a class="nav-btn solid" href="https://github.com/Shineii86/AniKotoAPI" target="_blank" rel="noopener">GitHub</a>
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
        const r = await apiGet('/library/search?keyword=' + encodeURIComponent(q));
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
      // Random picks from the stored library.
      const h = await apiGet('/library/home');
      const pool = h.latest || [];
      if (pool.length) location.href = animeHref(pool[Math.floor((Date.now() % pool.length))].id);
    } catch (_) { /* ignore */ }
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
}
