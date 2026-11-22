import { SEARCH_KINDS, SEARCH_GENRES, SEARCH_FORMATS, SEARCH_STATUSES, SEARCH_SORTS, searchFilters } from './search-filters.js';
import { paginationHTML } from './catalog-pagination.js';
import { historyImage } from './watch-history-store.js';

mountNav();
const form = document.getElementById('discoveryForm'), kinds = document.getElementById('searchKinds'), results = document.getElementById('discoveryResults');
const status = document.getElementById('discoveryStatusText'), retry = document.getElementById('retryDiscovery'), pagers = [document.getElementById('discoveryPagerTop'),document.getElementById('discoveryPager')];
let selection = searchFilters(Object.fromEntries(new URLSearchParams(location.search))), active = null, totalPages = 1, version = 0;
function options(id, values, placeholder) {
  const select = document.getElementById(id);
  if (placeholder) select.append(new Option(placeholder,''));
  for (const [value,label] of Array.isArray(values) ? values.map(item=>[item,item]) : Object.entries(values)) select.append(new Option(label,value));
}
options('discoveryGenre',SEARCH_GENRES,'Genres'); options('discoveryFormat',SEARCH_FORMATS,'Formats'); options('discoveryStatus',SEARCH_STATUSES,'Status'); options('discoverySort',SEARCH_SORTS);
function sync() {
  kinds.replaceChildren();
  for (const [kind,label] of Object.entries(SEARCH_KINDS)) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.kind = kind; button.setAttribute('aria-pressed',String(kind===selection.kind)); kinds.append(button);
  }
  for (const key of ['q','genre','format','status','year','sort']) form.elements.namedItem(key).value = selection[key] || '';
  document.getElementById('animeFilters').hidden = selection.kind !== 'anime';
  document.getElementById('discoveryQuery').placeholder = `Search ${SEARCH_KINDS[selection.kind].toLowerCase()}…`;
  document.title = `${selection.studio ? selection.studio+' Anime' : selection.q ? 'Search: '+selection.q : 'Search'} — Aniyear`;
}
function paintPages(busy = false) { for (const pager of pagers) pager.innerHTML = paginationHTML(Number(selection.page),totalPages,busy); }
function render(rows) {
  results.replaceChildren();
  for (const row of rows) {
    const anchor = document.createElement('a'); anchor.className = 'search-result-card';
    if (selection.kind === 'anime') {
      if (typeof row.slug !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,239}$/i.test(row.slug)) continue;
      anchor.href = '/anime/'+encodeURIComponent(row.slug);
    } else {
      if (!/^\d+$/.test(String(row.id))) continue;
      anchor.href = selection.kind === 'studios' ? '/search?'+new URLSearchParams({kind:'anime',studio:row.title}) : `https://anilist.co/${selection.kind === 'staff' ? 'staff' : 'character'}/${row.id}/`;
      if (selection.kind !== 'studios') {anchor.target='_blank';anchor.rel='noopener noreferrer';}
    }
    const cover = document.createElement('div'); cover.className='search-result-cover';
    const image = document.createElement('img'); image.className='search-result-image'; image.src=historyImage(row.poster); image.alt=''; image.loading='lazy'; image.decoding='async';
    cover.append(image);
    const title = document.createElement('strong'); title.textContent = row.title;
    const meta = document.createElement('small'); meta.textContent = selection.kind === 'anime' ? [row.type,row.year,row.rating ? '★ '+row.rating : ''].filter(Boolean).join(' · ') : selection.kind === 'studios' ? 'Browse studio anime →' : 'View on AniList ↗';
    anchor.append(cover,title,meta);results.append(anchor);
  }
  if (!results.children.length) {const empty=document.createElement('p');empty.className='discovery-empty';empty.textContent='No results found. Try a different search or reset the filters.';results.append(empty);}
}
async function load({navigate = true} = {}) {
  active?.abort(); const controller = new AbortController(), requestVersion = ++version; active=controller;
  if (navigate) history.pushState(null,'','/search?'+new URLSearchParams(selection));
  sync();retry.hidden=true;results.setAttribute('aria-busy','true');status.textContent='Searching…';paintPages(true);
  try {
    const data=await apiGet('/discovery?'+new URLSearchParams(selection),{signal:controller.signal});
    if (controller.signal.aborted || requestVersion!==version) return;
    if (!Array.isArray(data?.data) || !Number.isInteger(data.totalPages) || data.totalPages<1) throw new Error('Invalid search response. Please retry.');
    totalPages=data.totalPages;render(data.data);status.textContent=`Page ${selection.page} · ${data.data.length} results${selection.studio ? ' · '+selection.studio : ''}`;
    const live=document.getElementById('liveStatus'); if(live){live.textContent='Search ready';live.dataset.state='live';}
  } catch(error) {
    if (controller.signal.aborted || requestVersion!==version) return;
    results.replaceChildren();status.textContent=error.message || 'Search is unavailable. Please retry.';retry.hidden=false;
    const live=document.getElementById('liveStatus'); if(live){live.textContent='Search unavailable';live.dataset.state='stale';}
  } finally {if(requestVersion===version){results.setAttribute('aria-busy','false');paintPages();}}
}
function readForm() { return searchFilters({...Object.fromEntries(new FormData(form)),kind:selection.kind,page:'1'}); }
form.onsubmit=event=>{event.preventDefault();selection=readForm();void load();};
for(const field of form.querySelectorAll('select,input[type=number]')) field.addEventListener('change',()=>{selection=readForm();void load();});
kinds.onclick=event=>{const button=event.target.closest('button[data-kind]');if(button){selection=searchFilters({kind:button.dataset.kind,q:selection.q || '',page:'1'});void load();}};
document.getElementById('resetDiscovery').onclick=()=>{selection=searchFilters({kind:selection.kind});void load();};
for (const pager of pagers) pager.onclick=event=>{const button=event.target.closest('button[data-page]');if(button&&!button.disabled){selection={...selection,page:button.dataset.page};void load();}};
retry.onclick=()=>void load({navigate:false});
window.addEventListener('popstate',()=>{selection=searchFilters(Object.fromEntries(new URLSearchParams(location.search)));void load({navigate:false});});
window.addEventListener('pagehide',()=>active?.abort()); sync();void load({navigate:false});
