import { isCatalogSource, isAnimeType } from './catalog-sources.js';

/** @param {number} current @param {number} total @returns {(number | '…')[]} */
export function pageNumbers(current, total) {
  const last = Number.isSafeInteger(total) && total > 0 ? Math.min(total, 9999) : 1;
  const page = Math.max(1, Math.min(last, Number.isSafeInteger(current) ? current : 1));
  const values = new Set([1, last]);
  const start = page < 4 ? 1 : Math.max(1, page - 1);
  const end = page > last - 3 ? last : Math.min(last, Math.max(4, page + 1));
  for (let i = start; i <= end; i++) values.add(i);
  const result = [];
  for (const value of [...values].sort((a, b) => a - b)) {
    const previous = result.at(-1);
    if (typeof previous === 'number' && value > previous + 1) result.push('…');
    result.push(value);
  }
  return result;
}

/** @param {string} search @returns {import('./catalog.types.js').CatalogParams} */
export function catalogParams(search = '') {
  const query = new URLSearchParams(search);
  const rawPage = query.get('page') || '1';
  const source = query.get('source');
  /** @type {import('./catalog.types.js').CatalogParams} */
  const params = { source: isCatalogSource(source) ? source : 'latest', page: /^[1-9]\d{0,3}$/.test(rawPage) ? Number(rawPage) : 1 };
  const genre = query.get('genre');
  const letter = query.get('letter');
  const type = query.get('type');
  if (genre && /^[a-z0-9][a-z0-9_-]{0,239}$/i.test(genre)) params.genre = genre;
  else if (isAnimeType(type)) params.type = type;
  else if (letter && /^[a-z0]$/i.test(letter)) params.letter = letter.toLowerCase();
  return params;
}

export function paginationHTML(page, total, busy = false) {
  const button = (value, label, text, disabled = false) => `<button type="button" class="pager-btn${value === page ? ' on' : ''}" data-page="${value}" aria-label="${label}"${value === page ? ' aria-current="page"' : ''}${disabled || busy ? ' disabled' : ''}>${text}</button>`;
  return button(page - 1, 'Previous page', '‹', page <= 1)
    + pageNumbers(page, total).map(value => value === '…' ? '<span class="pager-gap" aria-hidden="true">…</span>' : button(value, `Page ${value}`, value)).join('')
    + button(page + 1, 'Next page', '›', page >= total)
    + `<span class="pager-now">Page ${page} of ${total}</span>`;
}
