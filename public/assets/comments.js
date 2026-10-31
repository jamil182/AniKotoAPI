import { accountRequest, safeReturnPath } from './accounts.js?v=google-1';
import { commentRequest } from './comments-api.js';
import { commentEscape as esc, commentMarkup, formatCommentSelection, timestampText } from './comment-markup.js';
import { commentShell, commentsHTML, reactionsHTML, commentEpisodeLabel } from './comments-view.js?v=media-2';
import { isComment, isCommentPage, isRepliesPage, isReactionSummary, commentFilterEpisode, commentFilterLocation } from './comment-data.js?v=4';
import { createCommentMediaPicker } from './comment-media-picker.js?v=2';
import { commentMediaHTML, hydrateCommentMedia } from './comment-media-view.js?v=2';

/** @param {HTMLElement} root
 * @param {{slug: string, episode?: number, episodes: Array<{episode_no: number | string}>, video?: HTMLVideoElement}} options */
export function mountComments(root, { slug, episode = 0, episodes, video }) {
  root.hidden = false; root.innerHTML = commentShell();
  const $ = selector => root.querySelector(selector);
  const editor = $('[data-text]'), form = $('[data-form]'), list = $('[data-list]');
  const feedback = $('[data-feedback]'), submit = form.querySelector('[type=submit]');
  const episodeSelect = $('[data-episodes]'), sortSelect = $('[data-sort]'), expanded = new Map();
  let user = null, sessionChecked = false, selected = commentFilterEpisode(location.search, episode), page = 1, data = null;
  let request = null, version = 0, timer = null, busy = false, reply = null, pendingDraft = null;
  let fingerprint = '', episodeSignature = '', preview = false;
  let previewSignature = '';
  const mediaPicker = createCommentMediaPicker(root, () => { pendingDraft = null; applyAuth(); });
  const next = () => safeReturnPath(location.pathname + location.search + '#comments');
  const options = () => ({ slug, watchEpisode: video ? episode : null, signedIn: Boolean(user) });
  function say(message, error = false) {
    feedback.textContent = message; feedback.hidden = !message; feedback.classList.toggle('error', error);
  }
  function postingEpisode() { return reply?.episode ?? (selected === 'all' ? episode : selected); }
  function timestampReady() { return Boolean(user && !busy && postingEpisode() === episode && video?.currentSrc && video.readyState >= 1); }
  function applyAuth() {
    const enabled = Boolean(user && !busy);
    $('[data-auth]').innerHTML = user ? 'Anda sudah login dan dapat mengirim komentar.' : !sessionChecked ? 'Memeriksa sesi login…' : `Anda harus <a href="/login?next=${encodeURIComponent(next())}">login</a> untuk mengirim komentar.`;
    editor.disabled = !enabled;
    mediaPicker.setEnabled(enabled);
    editor.required = !mediaPicker.value();
    for (const control of root.querySelectorAll('[data-tool],[data-emoji-toggle],[data-spoiler],[data-preview-toggle]')) control.disabled = !enabled;
    for (const control of root.querySelectorAll('[data-write]')) control.disabled = !enabled || (control.hasAttribute('data-mood') && !data) || (control.hasAttribute('data-reply') && control.dataset.locked === 'true');
    $('[data-timestamp]').hidden = !video;
    $('[data-timestamp]').disabled = !timestampReady();
    $('[data-length]').textContent = `${editor.value.length} / 4000`;
    $('[data-posting]').textContent = commentEpisodeLabel(postingEpisode());
    submit.disabled = !enabled || (!editor.value.trim() && !mediaPicker.value());
    submit.textContent = busy ? 'Mengirim…' : 'Post comment';
    episodeSelect.disabled = busy; sortSelect.disabled = busy;
    $('[data-reply-notice]').hidden = !reply;
    $('[data-reply-notice]').innerHTML = reply ? `Membalas ${esc(reply.author)} · ${esc(commentEpisodeLabel(reply.episode))} <button type="button" data-cancel-reply>× Batal</button>` : '';
    const previewKey = JSON.stringify([editor.value, mediaPicker.value()]);
    if (preview && previewSignature !== previewKey) {
      $('[data-preview]').innerHTML = commentMarkup(editor.value, Boolean(video && postingEpisode() === episode)) + commentMediaHTML(mediaPicker.value());
      previewSignature = previewKey; void hydrateCommentMedia($('[data-preview]'));
    }
  }
  async function session() {
    try {
      const result = await accountRequest('me');
      if (user?.id !== result.user?.id) { fingerprint = ''; expanded.clear(); }
      user = result.user; sessionChecked = true; applyAuth();
    } catch { if (!sessionChecked) { sessionChecked = true; applyAuth(); } }
  }
  function draw() {
    if (!data) return;
    const opened = [...list.querySelectorAll('details[open]')].map(node => node.closest('[data-comment-id]')?.dataset.commentId);
    const key = JSON.stringify([data.comments, user?.id, [...expanded]]);
    if (key !== fingerprint) {
      list.innerHTML = commentsHTML(data.comments, options(), expanded); fingerprint = key;
      void hydrateCommentMedia(list);
      for (const id of opened) list.querySelector(`[data-comment-id="${id}"] details`)?.setAttribute('open', '');
    }
    $('[data-reactions]').innerHTML = reactionsHTML(data.reactions, data.myReaction, Boolean(user));
    $('[data-total]').textContent = `${data.total} ${data.total === 1 ? 'Comment' : 'Comments'}`;
    $('[data-page]').textContent = `Page ${data.page} / ${data.pages}`;
    $('[data-prev]').disabled = busy || data.page <= 1; $('[data-next]').disabled = busy || data.page >= data.pages;
    applyAuth();
  }
  async function load(quiet = false) {
    if (document.hidden || (quiet && busy)) return;
    request?.abort(); const controller = new AbortController(), revision = ++version; request = controller;
    list.setAttribute('aria-busy', 'true');
    try {
      const response = await commentRequest('?' + new URLSearchParams({ slug, episode: String(selected), page: String(page), sort: sortSelect.value }), { signal: controller.signal });
      if (revision !== version) return;
      if (!isCommentPage(response)) throw new Error('Respons komentar tidak valid.');
      for (const item of response.comments) if (data?.comments.find(old => old.id === item.id)?.replyCount !== item.replyCount) expanded.delete(item.id);
      data = response; page = response.page; draw(); $('[data-retry]').hidden = true;
      if (feedback.dataset.loadingError === 'true') { say(''); delete feedback.dataset.loadingError; }
    } catch (error) {
      if (controller.signal.aborted || revision !== version) return;
      say(data ? 'Menampilkan komentar terakhir. Pembaruan belum berhasil.' : error.message, true); feedback.dataset.loadingError = 'true'; $('[data-retry]').hidden = false;
    } finally { if (revision === version) list.setAttribute('aria-busy', 'false'); }
  }
  async function replies(id, requestedPage) {
    const revision = version, result = await commentRequest(`/${id}/replies?page=${requestedPage}`);
    if (!isRepliesPage(result)) throw new Error('Respons balasan tidak valid.');
    if (revision !== version || !data?.comments.some(item => item.id === id)) return;
    expanded.set(id, result); fingerprint = ''; draw();
  }
  async function action(button, work) {
    if (!user || busy) return;
    const focusAttribute = ['data-like', 'data-mood', 'data-delete'].find(attribute => button?.hasAttribute(attribute));
    const focusValue = focusAttribute ? button.getAttribute(focusAttribute) : null;
    busy = true; applyAuth(); if (button) button.disabled = true;
    try { await work(); }
    catch (error) {
      if (error.status === 401) { user = null; sessionChecked = true; fingerprint = ''; }
      say(error.message + (error.retryAfter ? ` Coba lagi dalam ${error.retryAfter} detik.` : ''), true);
    } finally {
      busy = false; draw(); applyAuth();
      if (focusAttribute && document.activeElement === document.body) root.querySelector(`[${focusAttribute}="${focusValue}"]`)?.focus({ preventScroll: true });
    }
  }
  function find(id) {
    for (const item of data?.comments || []) {
      if (item.id === id) return item;
      const child = [...(item.replies || []), ...(expanded.get(item.id)?.comments || [])].find(value => value.id === id);
      if (child) return child;
    }
    return null;
  }
  function insert(value) {
    const start = editor.selectionStart, end = editor.selectionEnd;
    if (editor.value.length - (end - start) + value.length > 4000) { say('Komentar maksimal 4.000 karakter.', true); return; }
    editor.setRangeText(value, start, end, 'end'); editor.focus(); pendingDraft = null; applyAuth();
  }
  form.onsubmit = event => {
    event.preventDefault(); if (!user || busy || (!editor.value.trim() && !mediaPicker.value())) return;
    const payload = { slug, episode: postingEpisode(), body: editor.value, spoiler: $('[data-spoiler]').checked, parentId: reply?.id ?? null, media: mediaPicker.value() };
    const signature = JSON.stringify(payload);
    if (pendingDraft?.signature !== signature) pendingDraft = { signature, id: crypto.randomUUID() };
    void action(submit, async () => {
      const created = await commentRequest('', { method: 'POST', body: { ...payload, requestId: pendingDraft.id } });
      if (!isComment(created)) throw new Error('Respons pengiriman komentar tidak valid.');
      const parent = payload.parentId;
      editor.value = ''; $('[data-spoiler]').checked = false; pendingDraft = null; reply = null; preview = false; $('[data-preview]').hidden = true;
      mediaPicker.clear(); previewSignature = '';
      if (parent === null) { page = 1; sortSelect.value = 'newest'; }
      say('Komentar berhasil dikirim.'); await load();
      if (parent !== null) await replies(parent, 1000000);
      list.querySelector(`[data-comment-id="${created.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };
  editor.oninput = () => { pendingDraft = null; applyAuth(); };
  editor.onkeydown = event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !submit.disabled) { event.preventDefault(); form.requestSubmit(); } };
  $('[data-spoiler]').onchange = () => { pendingDraft = null; };
  root.onclick = event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.hasAttribute('data-rules')) { $('[data-rules-dialog]').showModal(); return; }
    if (button.hasAttribute('data-close-rules')) { $('[data-rules-dialog]').close(); return; }
    if (button.hasAttribute('data-reveal')) {
      const open = button.getAttribute('aria-expanded') !== 'true'; button.setAttribute('aria-expanded', String(open));
      button.children[0].hidden = open; button.children[1].hidden = !open; return;
    }
    if (button.dataset.seek !== undefined) {
      if (video?.currentSrc && video.readyState >= 1 && Number(button.dataset.seek) <= video.duration) { video.currentTime = Number(button.dataset.seek); video.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else say('Timestamp dapat digunakan pada mode Direct setelah video dimuat.');
      return;
    }
    if (button.hasAttribute('data-replies')) { button.disabled = true; void replies(Number(button.dataset.replies), Number(button.dataset.page)).catch(error => say(error.message, true)).finally(() => { if (button.isConnected) button.disabled = false; }); return; }
    if (button.hasAttribute('data-cancel-reply')) { reply = null; pendingDraft = null; applyAuth(); return; }
    if (button.hasAttribute('data-retry')) { void session().then(() => load()); return; }
    if (button.hasAttribute('data-prev') || button.hasAttribute('data-next')) { page += button.hasAttribute('data-next') ? 1 : -1; void load(); return; }
    if (!user || busy) return;
    if (button.dataset.tool) {
      const result = formatCommentSelection(editor.value, editor.selectionStart, editor.selectionEnd, button.dataset.tool);
      if (result.text.length > 4000) return;
      editor.value = result.text; editor.focus(); editor.setSelectionRange(result.start, result.end); pendingDraft = null; applyAuth(); return;
    }
    if (button.hasAttribute('data-timestamp')) { insert('[' + timestampText(video.currentTime) + ']'); return; }
    if (button.hasAttribute('data-emoji-toggle')) { const panel = $('[data-emojis]'); panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden)); return; }
    if (button.dataset.emoji) { insert(button.dataset.emoji); $('[data-emojis]').hidden = true; $('[data-emoji-toggle]').setAttribute('aria-expanded', 'false'); return; }
    if (button.hasAttribute('data-preview-toggle')) { preview = !preview; $('[data-preview]').hidden = !preview; applyAuth(); return; }
    if (button.dataset.reply) {
      const item = find(Number(button.dataset.reply)); if (!item || item.deleted) return;
      reply = { id: item.id, episode: item.episode, author: item.author }; pendingDraft = null; applyAuth(); editor.focus(); editor.scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
    }
    if (button.dataset.mood) { void action(button, async () => {
      const result = await commentRequest('/reaction', { method: 'PUT', body: { slug, mood: data?.myReaction === button.dataset.mood ? null : button.dataset.mood } });
      if (!isReactionSummary(result)) throw new Error('Respons reaksi tidak valid.');
      data.reactions = result.reactions; data.myReaction = result.myReaction;
    }); return; }
    if (button.dataset.like) {
      const item = find(Number(button.dataset.like)); if (!item) return;
      void action(button, async () => {
        const changed = await commentRequest(`/${item.id}/like`, { method: 'PUT', body: { liked: !item.liked } });
        if (!isComment(changed)) throw new Error('Respons suka tidak valid.');
        item.likes = changed.likes; item.liked = changed.liked;
        for (const page of expanded.values()) { const existing = page.comments.find(row => row.id === item.id); if (existing) { existing.likes = changed.likes; existing.liked = changed.liked; } }
        fingerprint = ''; await load();
      }); return;
    }
    if (button.dataset.delete && window.confirm('Hapus komentar Anda? Balasan yang sudah ada tetap ditampilkan.')) {
      void action(button, async () => { await commentRequest('/' + button.dataset.delete, { method: 'DELETE', body: {} }); say('Komentar dihapus.'); await load(); });
    }
  };
  function changeFilter() {
    selected = episodeSelect.value === 'all' ? 'all' : Number(episodeSelect.value); page = 1; data = null; reply = null; expanded.clear(); fingerprint = '';
    history.replaceState(null, '', commentFilterLocation(location.href, selected, episode));
    list.innerHTML = '<div class="comment-empty">Memuat komentar…</div>'; $('[data-total]').textContent = 'Memuat komentar…'; applyAuth(); void load();
  }
  episodeSelect.onchange = changeFilter; sortSelect.onchange = changeFilter;
  function updateEpisodes(values) {
    const numbers = [...new Set(values.map(item => Number(item.episode_no)).filter(value => Number.isFinite(value) && value > 0 && value <= 100000))].sort((a, b) => a - b).slice(0, 10000);
    const signature = JSON.stringify(numbers); if (signature === episodeSignature) return; episodeSignature = signature;
    episodeSelect.innerHTML = '<option value="0">Diskusi anime</option><option value="all">Semua episode</option>' + numbers.map(value => `<option value="${value}">Episode ${value}</option>`).join('');
    if (selected !== 'all' && selected !== 0 && !numbers.includes(selected)) selected = numbers.includes(episode) ? episode : 0;
    episodeSelect.value = String(selected); applyAuth();
  }
  function stop() { clearInterval(timer); request?.abort(); mediaPicker.close(); }
  function start() { clearInterval(timer); void session().then(() => load()); timer = setInterval(() => { if (!document.hidden && !busy) void session().then(() => load(true)); }, 30000); }
  const visibility = () => { if (document.hidden) request?.abort(); else void session().then(() => load(true)); };
  const pageshow = event => { if (event.persisted) start(); };
  document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', stop); window.addEventListener('pageshow', pageshow);
  const metadata = () => { $('[data-timestamp]').disabled = !timestampReady(); };
  video?.addEventListener('loadedmetadata', metadata); video?.addEventListener('emptied', metadata);
  $('[data-reactions]').innerHTML = reactionsHTML(); updateEpisodes(episodes); applyAuth(); start();
  return { updateEpisodes, destroy() { stop(); mediaPicker.destroy(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', stop); window.removeEventListener('pageshow', pageshow); video?.removeEventListener('loadedmetadata', metadata); video?.removeEventListener('emptied', metadata); } };
}
