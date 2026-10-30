import { catalogParams, paginationHTML } from './catalog-pagination.js';
import { cardProgressHTML, cardFormat } from './card-progress.js';
import { fillCatalogRow } from './catalog-row-fill.js';

/**
 * Share server pagination, cancellation and retry behavior on both views.
 * @param {import('./catalog.types.js').CatalogGridOptions} options
 */
export function createCatalogGrid({ grid, pager, viewMore = null, initial = catalogParams(), onNavigate = () => {}, fillRows = false, getMetadata = () => [] }) {
  const pagers = Array.isArray(pager) ? pager : [pager];
  let renderedColumns = 0;
  const columnCount = () => {
    const element = grid.querySelector('.grid');
    const tracks = element ? getComputedStyle(element).gridTemplateColumns : 'none';
    return tracks === 'none' ? 1 : tracks.trim().split(/\s+/).length;
  };
  let params = { ...initial }, total = 1, active = null, pending = null, activeKey = '', loadedKey = '', markup = '', fingerprint = '';
  const query = () => new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
  function paint(busy = false) {
    pagers.forEach(element => { element.innerHTML = paginationHTML(params.page, total, busy); });
    if (viewMore) viewMore.href = '/browse?' + query();
  }
  function refresh() {
    const key = query();
    if (pending && activeKey === key) return pending;
    active?.abort();
    const request = new AbortController();
    active = request;
    activeKey = key;
    grid.setAttribute('aria-busy', 'true');
    if (loadedKey !== key) grid.innerHTML = `<div class="grid">${skeletonCards(12)}</div>`;
    paint(true);
    const operation = (async () => {
      try {
        const data = await apiGet('/catalog/browse?' + key, { signal: request.signal });
        if (request.signal.aborted) return;
        if (!Array.isArray(data.data) || !Number.isInteger(data.totalPages) || data.totalPages < 1) throw new Error('Invalid catalog page. Please retry.');
        total = data.totalPages;
        if (params.page > total) { params.page = total; onNavigate({ ...params }, { replace: true }); return refresh(); }
        let items = data.data;
        let columns = columnCount();
        let candidates = [];
        if (fillRows && items.length && items.length % columns && total > 1) {
          try {
            const nextQuery = new URLSearchParams(key);
            nextQuery.set('page', String(params.page < total ? params.page + 1 : params.page - 1));
            const nextPage = await apiGet('/catalog/browse?' + nextQuery, { signal: request.signal });
            if (request.signal.aborted) return;
            if (Array.isArray(nextPage.data)) candidates = nextPage.data;
          } catch {
            if (request.signal.aborted) return;
            // A failed optional preview must not hide the current page.
          }
        }
        columns = columnCount();
        if (fillRows) items = fillCatalogRow(items, candidates, columns);
        renderedColumns = columns;
        const formats = new Map(getMetadata().filter(item => cardFormat(item.type)).map(item => [item.id, cardFormat(item.type)]));
        items = items.map(item => ({ ...item, type: cardFormat(item.type) || formats.get(item.id) || '' }));
        const next = JSON.stringify(items);
        if (loadedKey !== key || next !== fingerprint || grid.querySelector('.catalog-retry')) {
          markup = items.length ? `<div class="grid">${items.map(item => cardHTML(item, cardProgressHTML(item))).join('')}</div>` : '<div class="state">No anime found.</div>';
          grid.innerHTML = markup;
        }
        loadedKey = key;
        fingerprint = next;
      } catch (error) {
        if (request.signal.aborted) return;
        grid.innerHTML = `${loadedKey === key ? markup : ''}<div class="state catalog-retry" role="status">${esc(error.message)}<br><button type="button">Retry</button></div>`;
        grid.querySelector('.catalog-retry button').onclick = () => refresh().catch(() => {});
        throw error;
      } finally {
        if (active === request) { pending = null; grid.setAttribute('aria-busy', 'false'); paint(); }
      }
    })();
    pending = operation;
    return operation;
  }
  function set(next, { navigate = true } = {}) {
    params = catalogParams(new URLSearchParams(next).toString());
    if (navigate) onNavigate({ ...params });
    return refresh();
  }
  pagers.forEach(element => element.addEventListener('click', event => {
    const button = event.target.closest('button[data-page]');
    if (!button || button.disabled) return;
    const page = Number(button.dataset.page);
    if (!Number.isInteger(page) || page < 1 || page > total || page === params.page) return;
    set({ ...params, page }).catch(() => {});
    grid.closest('section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  window.addEventListener('pagehide', () => { active?.abort(); pending = null; activeKey = ''; });
  if (fillRows && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (loadedKey && columnCount() !== renderedColumns) refresh().catch(() => {});
    }).observe(grid);
  }
  return { refresh, set };
}
