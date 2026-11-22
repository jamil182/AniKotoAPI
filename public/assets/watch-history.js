import { createWatchHistoryStore, historyCompleted, historyImage } from './watch-history-store.js';
import { parseEmbedUrl } from './embed-policy.js';

let store;
export function browserHistoryStore() {
  if (!store) { let storage; try { storage = localStorage; } catch { storage = { getItem: () => null, setItem: () => { throw Error('Storage unavailable'); } }; } store = createWatchHistoryStore(storage); }
  return store;
}
export function formatWatchTime(value) { const seconds = Math.max(0,Math.floor(value)); return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`; }
/** @param {import('./watch-history.types.js').WatchHistoryEntry} row @param {boolean} [detail] */
export function watchHistoryCard(row, detail = false) {
  const anchor = document.createElement('a'); anchor.href = `/watch/${encodeURIComponent(row.slug)}/${row.episode}?resume=1`; anchor.className = detail ? 'history-card' : 'continue-card';
  const media = document.createElement('div'); media.className = 'history-media';
  const image = document.createElement('img'); image.src = historyImage(row.thumbnail || row.poster,true); image.alt = ''; image.loading = 'lazy';
  image.onerror = () => { image.onerror = null; image.src = historyImage(row.poster); };
  const duration = document.createElement('span'); duration.className = 'history-duration'; duration.textContent = formatWatchTime(row.duration);
  const progress = document.createElement('progress'); progress.max = row.duration; progress.value = row.time; progress.setAttribute('aria-label','Watch progress'); media.append(image,duration,progress);
  const copy = document.createElement('div'); copy.className = 'history-copy';
  const title = document.createElement('strong'); title.textContent = row.title;
  const episode = document.createElement('small'); episode.textContent = `Episode ${row.episode}${row.total ? ` / ${row.total}` : ''}`;
  copy.append(title,episode);
  if (detail) {
    const time = document.createElement('small'); time.textContent = `${formatWatchTime(row.time)} / ${formatWatchTime(row.duration)} · ${historyCompleted(row) ? 'Completed' : 'Watching'}`;
    const updated = document.createElement('time'); updated.dateTime = new Date(row.updated).toISOString(); updated.textContent = new Date(row.updated).toLocaleString(); copy.append(time,updated);
  }
  anchor.append(media,copy); return anchor;
}
function mountContinueWatching() {
  const main = document.querySelector('.main.wrap-home'); if (!main) return;
  const section = document.createElement('section'); section.className = 'miruro-continue wrap wrap-home'; section.id = 'continueWatching';
  const head = document.createElement('div'); head.className = 'section-head';
  const heading = document.createElement('h2'); heading.className = 'section-title'; heading.textContent = 'Continue Watching';
  const all = document.createElement('a'); all.href = '/history'; all.className = 'view-more'; all.textContent = 'View all ›'; head.append(heading,all);
  const grid = document.createElement('div'); grid.className = 'continue-grid'; section.append(head,grid); main.before(section);
  const render = () => {
    grid.replaceChildren();
    for (const row of browserHistoryStore().list().filter(row => row.time > 5 && !historyCompleted(row)).slice(0,4)) grid.append(watchHistoryCard(row));
    const history = document.createElement('a'); history.href = '/history'; history.className = 'continue-history'; history.textContent = '› View history'; grid.append(history);
    grid.classList.toggle('history-is-empty',grid.children.length === 1);
    if (grid.children.length === 1) { const empty = document.createElement('p'); empty.className = 'history-empty'; empty.textContent = 'Your in-progress episodes will appear here after you start watching.'; grid.prepend(empty); }
  };
  render(); window.addEventListener('storage',render); window.addEventListener('pageshow',render);
}
function recordProgress() {
  const match = /^\/watch\/([a-z0-9_-]+)\/(\d+(?:\.\d+)?)\/?$/i.exec(location.pathname), video = document.getElementById('video');
  if (!match || !(video instanceof HTMLVideoElement)) return;
  const slug = match[1], episode = Number(match[2]), saved = browserHistoryStore().list().find(row => row.slug === slug && row.episode === episode);
  let anime = null, lastSaved = 0, restored = false, thumbnail = saved?.thumbnail || '';
  if (new URLSearchParams(location.search).get('resume') === '1') {
    const servers = document.getElementById('servers'), mode = document.getElementById('modeDirect');
    if (servers && mode) {
      const chooseDirect = () => {
        if (mode.getAttribute('aria-pressed') === 'true') { observer.disconnect(); return; }
        if (servers.querySelector('button')) { observer.disconnect(); mode.click(); }
      };
      const observer = new MutationObserver(chooseDirect); observer.observe(servers,{childList:true,subtree:true}); chooseDirect();
      window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
    }
  }
  const restore = () => { if (restored || !Number.isFinite(video.duration) || video.duration <= 0) return; restored = true; if (saved && saved.time > 5 && saved.time < video.duration-30) video.currentTime = saved.time; };
  const capture = () => {
    if (video.readyState < 2 || !video.videoWidth) return;
    try { const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = Math.round(320 * video.videoHeight/video.videoWidth); canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height); thumbnail = canvas.toDataURL('image/jpeg',0.65); } catch { /* A provider may prohibit frame capture; its poster remains available. */ }
  };
  const save = (time, duration, force = false, direct = false) => {
    if (!anime || browserHistoryStore().paused() || duration < 30 || time < 1 || !Number.isFinite(time) || !Number.isFinite(duration) || (!force && Date.now()-lastSaved < 10000)) return;
    lastSaved = Date.now(); if (direct) capture();
    browserHistoryStore().save({ slug,episode,title:anime.title,poster:anime.poster,thumbnail:thumbnail || anime.poster,time,duration,updated:lastSaved,total:Number(anime.total) || null,type:anime.type || '' });
  };
  apiGet('/catalog/anime/'+encodeURIComponent(slug)).then(value => { anime = value; restore(); }).catch(() => {});
  video.addEventListener('loadedmetadata',restore); video.addEventListener('timeupdate',()=>save(video.currentTime,video.duration,false,true));
  video.addEventListener('pause',()=>save(video.currentTime,video.duration,true,true)); window.addEventListener('pagehide',()=>save(video.currentTime,video.duration,true,true));
  // Only accept progress messages from the currently mounted, allowlisted iframe.
  window.addEventListener('message', event => {
    const frame = document.querySelector('iframe.video-embed'), allowed = parseEmbedUrl(frame?.getAttribute('src'));
    if (!allowed || event.source !== frame.contentWindow || event.origin !== allowed.origin) return;
    let data = event.data; if (typeof data === 'string') { if (data.length > 4096) return; try { data = JSON.parse(data); } catch { return; } }
    if (!data || typeof data !== 'object' || !['timeupdate','progress','player:timeupdate'].includes(data.event || data.type)) return;
    const detail = data.data && typeof data.data === 'object' ? data.data : data;
    if (typeof detail.currentTime === 'number' && typeof detail.duration === 'number') save(detail.currentTime,detail.duration);
  });
}
export function mountWatchHistory() {
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/assets/watch-history.css?v=1'; document.head.append(css);
  mountContinueWatching(); recordProgress();
}
