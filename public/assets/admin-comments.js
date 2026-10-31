import { commentEscape as esc } from './comment-markup.js';
import { commentEpisodeLabel } from './comments-view.js?v=media-1';
import { commentMediaHTML, hydrateCommentMedia } from './comment-media-view.js';

/** @param {ReturnType<import('./admin-client.js').createAdminClient>} client */
export function createAdminComments(client, onUnauthorized) {
  const root = document.getElementById('adminComments'), rows = root.querySelector('[data-moderation-rows]');
  const message = root.querySelector('[data-moderation-error]'), state = root.querySelector('[data-moderation-state]');
  let page = 1, active = false, revision = 0;
  async function load() {
    if (!active) return;
    const current = ++revision;
    try {
      const data = await client.request('/comments?' + new URLSearchParams({ state: state.value, page: String(page) }));
      if (!active || current !== revision) return;
      if (!Array.isArray(data?.comments)) throw new Error('Respons moderasi komentar tidak valid.');
      page = data.page; message.textContent = '';
      rows.innerHTML = data.comments.length ? data.comments.map(item => `<article class="admin-comment-row"><div><b>${esc(item.author)}</b><span>${esc(item.animeSlug)} · ${esc(commentEpisodeLabel(item.episode))}${item.parentId ? ' · Balasan' : ''}</span><p>${esc(item.body)}</p><small>${esc(new Date(item.createdAt).toLocaleString('id-ID'))}${item.deletedAt === null ? '' : item.deletedByAdmin ? ' · Disembunyikan admin' : ' · Dihapus penulis'}</small></div><button class="btn" type="button" data-moderate="${item.id}" data-hidden="${item.deletedAt === null}" ${item.deletedAt !== null && !item.deletedByAdmin ? 'disabled' : ''}>${item.deletedAt === null ? 'Sembunyikan' : 'Pulihkan'}</button></article>`).join('') : '<p class="cms-muted">Tidak ada komentar pada filter ini.</p>';
      root.querySelector('[data-moderation-page]').textContent = `${data.total} komentar · ${data.page} / ${data.pages}`;
      for (const item of data.comments) if (item.media) {
        const button = rows.querySelector(`[data-moderate="${item.id}"]`);
        button?.closest('article')?.querySelector('div')?.insertAdjacentHTML('beforeend', commentMediaHTML(item.media));
      }
      void hydrateCommentMedia(rows);
      root.querySelector('[data-moderation-prev]').disabled = data.page <= 1;
      root.querySelector('[data-moderation-next]').disabled = data.page >= data.pages;
    } catch (error) {
      if (!active || current !== revision) return;
      message.textContent = error.message;
      if (error.status === 401 || error.status === 503) onUnauthorized();
    }
  }
  root.onclick = async event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.hasAttribute('data-moderation-refresh')) { void load(); return; }
    if (button.hasAttribute('data-moderation-prev') || button.hasAttribute('data-moderation-next')) { page += button.hasAttribute('data-moderation-next') ? 1 : -1; void load(); return; }
    if (button.dataset.moderate) {
      button.disabled = true;
      try { await client.request('/comments/' + button.dataset.moderate, { method: 'PATCH', body: { hidden: button.dataset.hidden === 'true' } }); await load(); }
      catch (error) { message.textContent = error.message; if (error.status === 401 || error.status === 503) onUnauthorized(); }
      finally { if (button.isConnected) button.disabled = false; }
    }
  };
  state.onchange = () => { page = 1; void load(); };
  return { start() { active = true; void load(); }, stop() { active = false; revision++; rows.replaceChildren(); message.textContent = ''; } };
}
