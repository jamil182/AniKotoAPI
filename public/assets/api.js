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
