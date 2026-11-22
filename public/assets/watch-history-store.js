export const HISTORY_KEY = 'aniyear:continue-watching:v1';
const pauseKey = 'aniyear:history-paused:v1', undoKey = 'aniyear:history-undo:v1';
/** @param {unknown} value */
export function historyImage(value, thumbnail = false) {
  if (thumbnail && typeof value === 'string' && value.length <= 100000 && /^data:image\/jpeg;base64,[a-z0-9+/]+=*$/i.test(value)) return value;
  if (value === '/favicon.svg') return value;
  try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password ? url.href : '/favicon.svg'; } catch { return '/favicon.svg'; }
}
/** @param {unknown} value @returns {import('./watch-history.types.js').WatchHistoryEntry | null} */
export function historyEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = /** @type {Record<string,unknown>} */(value);
  if (typeof row.slug !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,239}$/i.test(row.slug) || typeof row.title !== 'string' || !row.title.trim()) return null;
  for (const field of ['episode','time','duration','updated']) if (typeof row[field] !== 'number' || !Number.isFinite(row[field])) return null;
  if (row.episode <= 0 || row.episode > 100000 || row.duration < 30 || row.duration > 86400 || row.time < 0 || row.time > row.duration + 2 || row.updated <= 0) return null;
  return { slug: row.slug, title: row.title.trim().slice(0,300), episode: row.episode, time: Math.min(row.time,row.duration), duration: row.duration, updated: row.updated,
    poster: historyImage(row.poster), thumbnail: historyImage(row.thumbnail || row.poster, true), type: typeof row.type === 'string' ? row.type.slice(0,30) : '',
    total: typeof row.total === 'number' && Number.isSafeInteger(row.total) && row.total >= row.episode && row.total <= 100000 ? row.total : null };
}
/** @param {import('./watch-history.types.js').WatchHistoryEntry} row */
export const historyCompleted = row => row.time >= row.duration - 30;
/** @param {Pick<Storage,'getItem'|'setItem'>} storage @param {() => number} [now] */
export function createWatchHistoryStore(storage, now = Date.now) {
  const read = key => { try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; } };
  const write = (key, value) => { try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  const list = () => {
    const value = read(HISTORY_KEY), seen = new Set();
    return (Array.isArray(value) ? value : []).map(historyEntry).filter(row => {
      if (!row || seen.has(row.slug)) return false; seen.add(row.slug); return true;
    }).sort((a,b) => b.updated-a.updated).slice(0,50);
  };
  const paused = () => read(pauseKey) === true;
  return {
    list, paused,
    setPaused: value => write(pauseKey, value === true),
    save(value) {
      if (paused()) return false; const row = historyEntry(value); if (!row) return false;
      return write(HISTORY_KEY, [row, ...list().filter(item => item.slug !== row.slug)].slice(0,50));
    },
    remove: slug => write(HISTORY_KEY, list().filter(row => row.slug !== slug)),
    clear() { if (!write(undoKey, { until: now()+86400000, rows: list() })) return false; return write(HISTORY_KEY, []); },
    canUndo() { const backup = read(undoKey); return backup?.until > now() && Array.isArray(backup.rows) && backup.rows.length > 0; },
    undo() {
      const backup = read(undoKey); if (!backup || backup.until <= now() || !Array.isArray(backup.rows)) return false;
      const merged = new Map(list().map(row => [row.slug,row]));
      for (const value of backup.rows) { const row = historyEntry(value); if (row && !merged.has(row.slug)) merged.set(row.slug,row); }
      if (!write(HISTORY_KEY, [...merged.values()].sort((a,b) => b.updated-a.updated).slice(0,50))) return false;
      write(undoKey,null); return true;
    },
  };
}
