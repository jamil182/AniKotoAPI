/** @param {unknown} value @returns {number | null} */
const positiveCount = value => {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+(?:\.\d+)?$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1000000 ? number : null;
};

/** @param {import('./card-progress.types.js').EpisodeCard} item */
export function episodeProgress(item) {
  const sub = positiveCount(item.sub);
  const dub = positiveCount(item.dub);
  const total = [item.total, item.total_episodes, item.totalEpisodes, item.episodes]
    .map(positiveCount).find(value => value !== null && Number.isInteger(value) && value > 0 && value >= Math.max(sub || 0, dub || 0)) ?? null;
  return { sub, dub, total };
}

/** @param {unknown} value @returns {string} */
export function cardFormat(value) {
  const types = { tv: 'TV', movie: 'Movie', ova: 'OVA', ona: 'ONA', special: 'Special', 'tv short': 'TV Short' };
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return Object.hasOwn(types, key) ? types[key] : '';
}

/** @param {import('./card-progress.types.js').EpisodeCard} item @returns {string} */
export function cardProgressHTML(item) {
  const { sub, dub, total } = episodeProgress(item);
  const microphone = '<svg viewBox="0 0 16 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="5" y="1" width="6" height="11" rx="3"/><path d="M2 8v2a6 6 0 0 0 12 0V8M8 16v3M4 19h8"/></svg>';
  const badge = (language, released) => `<span class="episode-progress" aria-label="${language}: ${released ?? '?'} released / ${total ?? '?'} total episodes" title="${language}: ${released ?? '?'} / ${total ?? '?'} episodes"><span class="episode-released">${language === 'SUB' ? '<span class="episode-cc" aria-hidden="true">CC</span>' : microphone}${released ?? '?'}</span><span class="episode-total">/ ${total ?? '?'}</span></span>`;
  const badges = [];
  if (sub > 0) badges.push(badge('SUB', sub));
  if (dub > 0) badges.push(badge('DUB', dub));
  if (!badges.length) badges.push(badge('SUB', sub ?? dub));
  const type = cardFormat(item.type);
  return `<div class="card-progress-bar"><div class="card-episode-counts">${badges.join('')}</div>${type ? `<span class="card-format">${type}</span>` : ''}</div>`;
}
