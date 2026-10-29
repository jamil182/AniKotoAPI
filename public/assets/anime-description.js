const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

/** @param {unknown} value @returns {number | null} */
export function animeScore(value) {
  const match = String(value ?? '').trim().match(/^(\d+(?:\.\d+)?)\b/);
  const score = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(score) && score >= 0 && score <= 10 ? score : null;
}

function imageUrl(value) {
  if (typeof value !== 'string') return '/favicon.svg';
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : '/favicon.svg'; }
  catch { return '/favicon.svg'; }
}
function values(value) {
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string').join(', ');
  return typeof value === 'string' ? value : '';
}
function fact(label, value) {
  const text = value === null || value === undefined || value === '' ? '—' : String(value);
  return `<div class="anime-fact"><dt>${escapeHTML(label)}:</dt><dd>${escapeHTML(text)}</dd></div>`;
}

/**
 * @param {import('./anime-description.types.js').AnimeDescription} info
 * @param {{heading?: 'h1' | 'h2', detailHref?: string}} options
 */
export function animeDescriptionHTML(info, { heading = 'h2', detailHref = '' } = {}) {
  const tag = heading === 'h1' ? 'h1' : 'h2';
  const title = info.title || 'Untitled anime';
  const alt = values(info.altNames || info.alt_names || info.japaneseTitle || info.japanese_title);
  const synopsis = info.synopsis || info.description || 'No synopsis available.';
  const score = animeScore(info.rating) ?? animeScore(info.malScore ?? info.mal_score);
  const malScore = animeScore(info.malScore ?? info.mal_score) ?? score;
  const scoreText = score === null ? 'N/A' : score.toFixed(2);
  const reviews = Number(String(info.reviewCount ?? info.review_count ?? '').replace(/,/g, ''));
  const reviewText = Number.isSafeInteger(reviews) && reviews > 0 ? `${reviews.toLocaleString('en-US')} reviews` : 'Catalog score';
  const total = info.total ?? info.totalEpisodes ?? info.total_episodes ?? info.episodes;
  const badges = [
    info.quality ? escapeHTML(info.quality) : '',
    Number(info.sub) > 0 ? 'SUB' : '', Number(info.dub) > 0 ? 'DUB' : '',
  ].filter(Boolean);
  const detail = /^\/anime\/[a-z0-9_%\-]+$/i.test(detailHref)
    ? `<a class="anime-full-details" href="${escapeHTML(detailHref)}">Full details →</a>` : '';
  return `<section class="anime-description" aria-label="Anime description">
    <div class="anime-description-poster"><img src="${escapeHTML(imageUrl(info.poster))}" alt="${escapeHTML(title)}" loading="lazy"></div>
    <div class="anime-description-content">
      <${tag} class="anime-description-title">${escapeHTML(title)}</${tag}>
      ${alt && alt !== title ? `<p class="anime-description-alias">${escapeHTML(alt)}</p>` : ''}
      ${badges.length ? `<div class="anime-description-badges">${badges.map(label => `<span>${label}</span>`).join('')}</div>` : ''}
      <div class="anime-description-synopsis"><p class="anime-synopsis-text">${escapeHTML(synopsis)}</p><button type="button" class="anime-synopsis-toggle" aria-expanded="false">[more]</button></div>
      <div class="anime-description-facts">
        <dl>${fact('Type', info.type)}${fact('Premiered', info.premiered || info.year)}${fact('Aired', info.aired)}${fact('Status', info.status)}${fact('Genres', values(info.genres))}</dl>
        <dl>${fact('MAL', malScore === null ? null : malScore.toFixed(2))}${fact('Duration', info.duration)}${fact('Episodes', total)}${fact('Studios', values(info.studios))}${fact('Producers', values(info.producers))}</dl>
      </div>${detail}
    </div>
    <aside class="anime-rating-card" aria-label="Anime rating">
      <div class="anime-rating-score"><strong>${scoreText}${score === null ? '' : ' <span>/10</span>'}</strong><small>${escapeHTML(reviewText)}</small></div>
      <div class="anime-rating-stars" role="img" aria-label="${score === null ? 'No rating available' : `${score.toFixed(2)} out of 10`}"><span aria-hidden="true">★★★★★</span><span class="anime-rating-stars-fill" style="width:${score === null ? 0 : score * 10}%" aria-hidden="true">★★★★★</span></div>
      <p>Score from the anime catalog</p>
      <svg class="anime-rating-decoration" viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="M44 14h23v20H56l-8 8v-8h-4V14Z" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="m54 22-2 7h8l2-7h-5l1-4" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M9 46h23v17H22l-7 7v-7H9V46Z" stroke="currentColor" stroke-opacity=".25" stroke-width="4" stroke-linejoin="round"/></svg>
    </aside>
  </section>`;
}

const instances = new WeakMap();

/**
 * Preserve expanded descriptions across the catalog's automatic refreshes.
 * @param {HTMLElement} host
 * @param {import('./anime-description.types.js').AnimeDescription} info
 * @param {{heading?: 'h1' | 'h2', detailHref?: string}} options
 */
export function mountAnimeDescription(host, info, options = {}) {
  let state = instances.get(host);
  if (!state) {
    state = { fingerprint: '', expanded: false };
    instances.set(host, state);
    const measure = () => {
      const text = host.querySelector('.anime-synopsis-text');
      const button = host.querySelector('.anime-synopsis-toggle');
      if (text && button) button.hidden = !state.expanded && text.scrollHeight <= text.clientHeight + 1;
    };
    host.addEventListener('click', event => {
      const button = event.target.closest?.('.anime-synopsis-toggle');
      if (!button) return;
      state.expanded = !state.expanded;
      host.querySelector('.anime-synopsis-text').classList.toggle('expanded', state.expanded);
      button.setAttribute('aria-expanded', String(state.expanded));
      button.textContent = state.expanded ? '[less]' : '[more]';
      measure();
    });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(host);
    state.measure = measure;
  }
  const fingerprint = JSON.stringify({ info, options });
  if (state.fingerprint === fingerprint) return;
  state.fingerprint = fingerprint;
  host.classList.add('anime-description-host');
  host.innerHTML = animeDescriptionHTML(info, options);
  const text = host.querySelector('.anime-synopsis-text');
  const button = host.querySelector('.anime-synopsis-toggle');
  text.classList.toggle('expanded', state.expanded);
  button.setAttribute('aria-expanded', String(state.expanded));
  button.textContent = state.expanded ? '[less]' : '[more]';
  state.measure();
}
