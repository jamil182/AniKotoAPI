import { browserHistoryStore, watchHistoryCard } from './watch-history.js?v=2';
import { historyCompleted } from './watch-history-store.js';

mountNav();
const store = browserHistoryStore(), grid = document.getElementById('historyList'), search = document.getElementById('historySearch'), state = document.getElementById('historyState'), sort = document.getElementById('historySort');
const pause = document.getElementById('pauseHistory'), clear = document.getElementById('clearHistory'), undo = document.getElementById('undoHistory'), feedback = document.getElementById('historyFeedback');
function render() {
  const all = store.list(), term = search.value.trim().toLocaleLowerCase();
  const rows = all.filter(row => row.title.toLocaleLowerCase().includes(term) && (state.value === 'all' || historyCompleted(row) === (state.value === 'completed')));
  if (sort.value === 'title') rows.sort((a,b) => a.title.localeCompare(b.title));
  document.getElementById('historyCount').textContent = `${all.length} ${all.length === 1 ? 'title' : 'titles'} · continue where you left off`;
  grid.replaceChildren(...rows.map(row => watchHistoryCard(row,true)));
  if (!rows.length) { const empty = document.createElement('p'); empty.className = 'history-empty'; empty.textContent = all.length ? 'No matching titles.' : 'No watch history yet. Start an episode and it will appear here.'; grid.append(empty); }
  pause.textContent = store.paused() ? '▶ Resume history' : 'Ⅱ Pause history'; pause.setAttribute('aria-pressed',String(store.paused()));
  clear.disabled = !all.length; undo.hidden = !store.canUndo();
}
search.addEventListener('input',render); state.addEventListener('change',render); sort.addEventListener('change',render);
pause.onclick = () => { feedback.textContent = store.setPaused(!store.paused()) ? (store.paused() ? 'History recording paused.' : 'History recording resumed.') : 'Browser storage is unavailable.'; render(); };
clear.onclick = () => { feedback.textContent = store.clear() ? 'History cleared. Undo is available for 24 hours.' : 'History could not be cleared.'; render(); };
undo.onclick = () => { feedback.textContent = store.undo() ? 'History restored.' : 'History could not be restored.'; render(); };
window.addEventListener('storage',render); window.addEventListener('pageshow',render); render();
