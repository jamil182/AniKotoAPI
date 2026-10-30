import { catalogParams } from './catalog-pagination.js';
import { createCatalogGrid } from './catalog-grid.js?v=language-1';
import { CATALOG_VIEWS, ANIME_TYPES } from './catalog-sources.js';

mountNav();
const initial = catalogParams(location.search);
function showSelection(params) {
  document.querySelectorAll('#browseTabs button').forEach(button => button.classList.toggle('on', button.dataset.src === params.source));
  const filter = params.genre ? `Genre: ${params.genre}.` : params.letter ? `Titles starting with ${params.letter === '0' ? '#' : params.letter.toUpperCase()}.` : '';
  const view = CATALOG_VIEWS[params.source];
  let title = params.type ? ANIME_TYPES[params.type] : view.title;
  if (params.genre) title = params.genre.replace(/-/g, ' ') + ' Anime';
  if (params.letter) title = 'Anime: ' + params.letter.toUpperCase();
  if (Number(params.page) > 1) title += ' — Page ' + params.page;
  document.getElementById('browseTitle').textContent = title;
  document.title = title + ' — ' + (document.querySelector('meta[name="application-name"]')?.content || 'Aniyear');
  document.getElementById('browseDescription').textContent = filter || (params.type ? 'Browse anime by type.' : view.description);
}
const catalog = createCatalogGrid({
  grid: document.getElementById('catalogGrid'), pager: [document.getElementById('catalogPagerTop'), document.getElementById('catalogPager')], initial, fillRows: true,
  onNavigate: (params, { replace = false } = {}) => {
    history[replace ? 'replaceState' : 'pushState'](null, '', '/browse?' + new URLSearchParams(params));
    showSelection(params);
  },
});
showSelection(initial);
document.getElementById('browseTabs').onclick = event => {
  const button = event.target.closest('button[data-src]');
  if (button) catalog.set({ source: button.dataset.src, page: 1 }).catch(() => {});
};
window.addEventListener('popstate', () => { const params = catalogParams(location.search); showSelection(params); catalog.set(params, { navigate: false }).catch(() => {}); });
startLiveRefresh(() => catalog.refresh(), { onData: () => {} });
