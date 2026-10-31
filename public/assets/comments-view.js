import { commentEscape as esc, commentMarkup } from './comment-markup.js';
import { COMMENT_MOODS } from './comment-data.js';
import { commentMediaHTML } from './comment-media-view.js?v=2';

export function reactionsHTML(counts = {}, current = null, signedIn = false) {
  return COMMENT_MOODS.map(item => `<button type="button" class="comment-reaction" data-mood="${item.key}" data-write aria-pressed="${current === item.key}" ${signedIn ? '' : 'disabled'} title="${signedIn ? item.label : 'Login untuk memberi reaksi'}"><span aria-hidden="true">${item.emoji}</span><b>${item.label}</b><span>${Number.isSafeInteger(counts[item.key]) && counts[item.key] >= 0 ? counts[item.key] : 0}</span></button>`).join('');
}
export function commentEpisodeLabel(episode) { return Number(episode) === 0 ? 'Diskusi anime' : 'Episode ' + episode; }
/** @param {import('./comments.types.js').Comment} item */
export function commentHTML(item, { slug, watchEpisode = null, signedIn = false, replyTo = item.id, canReply = true } = {}) {
  const deleted = item.deleted, initial = deleted ? '−' : Array.from(item.author || '?')[0];
  const timestamp = new Date(item.createdAt);
  const when = Number.isFinite(timestamp.getTime()) ? timestamp.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const content = commentMarkup(item.body, Number(item.episode) === watchEpisode) + commentMediaHTML(item.media);
  return `<article class="comment-item ${item.parentId === null ? '' : 'comment-reply'}" data-comment-id="${esc(item.id)}">
    <span class="comment-avatar" aria-hidden="true">${esc(initial)}</span><div class="comment-main">
    <div class="comment-meta"><b>${esc(item.author)}</b><span class="comment-episode">${esc(commentEpisodeLabel(item.episode))}</span><time datetime="${esc(Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : '')}">${esc(when)}</time></div>
    <div class="comment-body">${deleted ? '<p>Komentar telah dihapus.</p>' : item.spoiler ? `<details class="comment-full-spoiler"><summary>Lihat komentar spoiler</summary><div>${content}</div></details>` : content}</div>
    ${deleted ? '' : `<div class="comment-actions"><button type="button" data-like="${esc(item.id)}" data-write aria-pressed="${Boolean(item.liked)}" ${signedIn ? '' : 'disabled'}>♡ <span>${esc(item.likes)}</span><span class="sr-only"> suka</span></button><button type="button" data-reply="${esc(replyTo)}" data-write data-locked="${!canReply}" ${signedIn && canReply ? '' : 'disabled'}>Reply</button>${item.canDelete ? `<button type="button" data-delete="${esc(item.id)}" data-write>Hapus</button>` : ''}</div>`}
    </div></article>`;
}
/** @param {import('./comments.types.js').Comment[]} rows */
export function commentsHTML(rows, options, expanded = new Map()) {
  if (!rows.length) return '<div class="comment-empty">Belum ada komentar. Jadilah yang pertama berbagi pendapat.</div>';
  return rows.map(item => {
    const page = expanded.get(item.id), replies = page?.comments || item.replies || [];
    return `<div class="comment-thread" data-thread="${esc(item.id)}">${commentHTML(item, options)}<div class="comment-replies">${replies.map(reply => commentHTML(reply, { ...options, replyTo: item.id, canReply: !item.deleted })).join('')}
      ${page ? `<div class="comment-reply-pages"><button type="button" data-replies="${esc(item.id)}" data-page="${esc(page.page - 1)}" ${page.page <= 1 ? 'disabled' : ''}>‹</button><span>Balasan · ${esc(page.page)} / ${esc(page.pages)}</span><button type="button" data-replies="${esc(item.id)}" data-page="${esc(page.page + 1)}" ${page.page >= page.pages ? 'disabled' : ''}>›</button></div>` : item.replyCount > replies.length ? `<button type="button" class="comment-more" data-replies="${esc(item.id)}" data-page="1">Lihat semua balasan (${esc(item.replyCount)})</button>` : ''}</div></div>`;
  }).join('');
}

export function commentShell() {
  return `<h2 class="comments-title">COMMENTS</h2><div class="comment-reactions" data-reactions aria-label="Reaksi anime"></div>
    <div class="comment-rules-note"><b>Note:</b> Luangkan waktu membaca <button type="button" data-rules>aturan komentar</button> sebelum mengirim.</div>
    <div class="comment-filters"><select data-episodes aria-label="Episode komentar"></select><span class="comment-total" role="status"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 11c0 4-3.6 7-8 7H4l-3 3 1-6c-1-1-1-3-1-4 0-4 3.6-7 8-7s8 3 8 7Zm1-4c3 1 5 3 5 6 0 1-1 3-2 4l1 5-4-2h-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg><span data-total>Memuat komentar…</span></span><label>Sort by <select data-sort aria-label="Urutan komentar"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="popular">Most liked</option></select></label></div>
    <div class="comment-composer"><span class="comment-avatar" aria-hidden="true">☺</span><div class="comment-compose-main"><p data-auth class="comment-auth"></p><div data-reply-notice class="comment-reply-notice" hidden></div>
    <form data-form><div class="comment-editor"><div class="comment-tools" role="toolbar" aria-label="Format komentar"><button type="button" data-tool="bold" title="Bold" aria-label="Bold" disabled><b>B</b></button><button type="button" data-tool="italic" title="Italic" aria-label="Italic" disabled><i>I</i></button><button type="button" data-tool="strike" title="Strikethrough" aria-label="Strikethrough" disabled><s>S</s></button><button type="button" data-tool="quote" title="Quote" aria-label="Quote" disabled>❞</button><button type="button" data-tool="spoiler" title="Spoiler" aria-label="Sembunyikan teks spoiler" disabled>◉</button><button type="button" data-timestamp title="Sisipkan waktu video" aria-label="Sisipkan waktu video" disabled>◷</button></div>
    <textarea data-text rows="3" maxlength="4000" placeholder="Leave a comment" aria-label="Leave a comment" required disabled></textarea><div class="comment-editor-actions"><button type="button" data-emoji-toggle aria-label="Pilih emoji" aria-expanded="false" disabled>☺</button><button type="button" data-media-toggle title="GIF / Images" aria-label="Add GIF or image" aria-expanded="false" disabled><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 8h4m-4 4h4m-4 4h4m10-8h4m-4 4h4m-4 4h4"/></svg></button></div><div class="comment-emojis" data-emojis hidden>${['😀','😂','😭','🔥','❤️','👍','😍','🤯'].map(emoji => `<button type="button" data-emoji="${emoji}" aria-label="${emoji}">${emoji}</button>`).join('')}</div></div>
    <div class="comment-media-selection" data-media-selection hidden translate="no"></div><div class="comment-submit-row"><label><input type="checkbox" data-spoiler disabled> Spoiler</label><span data-posting></span><span data-length>0 / 4000</span><button type="button" class="comment-preview-button" data-preview-toggle disabled>Preview</button><button class="comment-submit" type="submit" disabled>Post comment</button></div><div class="comment-preview" data-preview hidden></div></form></div></div>
    <p class="comment-feedback" data-feedback role="status" aria-live="polite" hidden></p><button type="button" class="comment-more" data-retry hidden>Coba lagi</button><div data-list class="comment-list" aria-busy="true"></div>
    <nav class="comment-pagination" aria-label="Halaman komentar"><button type="button" data-prev disabled>‹ Previous</button><span data-page></span><button type="button" data-next disabled>Next ›</button></nav>
    <dialog class="comment-rules" data-rules-dialog><h3>Aturan komentar</h3><ul><li>Hormati pengguna lain. Hindari hinaan, ancaman, dan ujaran kebencian.</li><li>Jangan mengirim spam, promosi, atau informasi pribadi.</li><li>Gunakan penanda Spoiler untuk alur cerita yang belum ditonton orang lain.</li><li>Bahas anime dan episode yang sesuai. Admin dapat menyembunyikan komentar yang melanggar.</li></ul><button type="button" data-close-rules>Tutup</button></dialog>`;
}
