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
function cardHTML(item) {
  const title = item.title || item.name || 'Untitled';
  const type = item.type || '';
  return `
    <div class="card" data-slug="${esc(animeSlug(item.slug))}">
      <div class="card-poster">
        <img loading="lazy" src="${esc(item.poster)}" alt="${esc(title)}"
             onerror="this.style.visibility='hidden'">
        <div class="card-badges">${subDubChips(item)}</div>
        ${type ? `<span class="card-type">${esc(type)}</span>` : ''}
      </div>
      <div class="card-title">${esc(title)}</div>
      ${item.rating ? `<div class="card-sub">★ ${esc(item.rating)}</div>` : ''}
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
const animeHref = (slug) => '/anime/' + encodeURIComponent(animeSlug(slug));

// Any element carrying a non-empty data-slug navigates to that anime's detail
// page. One delegated listener covers cards, ranking rows, and search results,
// on every page, without per-element wiring.
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-slug]');
  if (el && el.dataset.slug) location.href = animeHref(el.dataset.slug);
});

// ---- Shared nav ----
// Markup + behaviour for the top bar, so the home and detail pages share one
// implementation. `active` dims the matching nav link.
function navHTML(active) {
  const on = (k) => active === k ? ' style="color:var(--ink)"' : '';
  return `
    <div class="wrap nav-inner">
      <a href="/" class="logo">Ani<b>Js</b></a>
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
        const r = await apiGet('/search?keyword=' + encodeURIComponent(q));
        const items = (r.data || []).slice(0, 6);
        drop.innerHTML = items.length
          ? items.map(it => `
              <div class="search-row" data-slug="${esc(animeSlug(it.slug))}">
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
      const r = await apiGet('/random');
      if (r && r.slug) location.href = animeHref(r.slug);
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
