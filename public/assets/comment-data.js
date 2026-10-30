export const COMMENT_MOODS = Object.freeze([
  { key: 'peak', label: 'Peak', emoji: '🔥' }, { key: 'mid', label: 'Mid', emoji: '😐' },
  { key: 'crying', label: 'Crying', emoji: '😭' }, { key: 'sus', label: 'Sus', emoji: '🤨' },
  { key: 'angry', label: 'Angry', emoji: '😡' }, { key: 'good', label: 'Good', emoji: '👍' },
  { key: 'funny', label: 'Funny', emoji: '😂' }, { key: 'shocked', label: 'Shocked', emoji: '😱' },
  { key: 'wholesome', label: 'Wholesome', emoji: '🥰' },
]);
export const COMMENT_PAGE_SIZE = 20;
export const REPLY_PREVIEW_SIZE = 3;
export const COMMENT_MAX_LENGTH = 4000;

export function commentFilterEpisode(search, fallback = 0) {
  const value = new URLSearchParams(search).get('commentsEpisode');
  if (value === 'all') return 'all';
  return value !== null && /^\d{1,6}(?:\.\d{1,3})?$/.test(value) && Number(value) <= 100000 ? Number(value) : fallback;
}
export function commentFilterLocation(href, selected, fallback = 0) {
  const url = new URL(href);
  if (selected === fallback) url.searchParams.delete('commentsEpisode');
  else url.searchParams.set('commentsEpisode', String(selected));
  return url.pathname + url.search + url.hash;
}

const count = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => count(value) && value > 0;
/** @param {unknown} value @returns {value is import('./comments.types.js').Comment} */
export function isComment(value, withReplies = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = /** @type {Partial<import('./comments.types.js').Comment>} */ (value);
  return Boolean(positive(row.id) && typeof row.animeSlug === 'string'
    && Number.isFinite(row.episode) && row.episode >= 0 && row.episode <= 100000
    && (row.parentId === null || positive(row.parentId)) && typeof row.author === 'string' && row.author.length <= 60
    && typeof row.body === 'string' && row.body.length <= COMMENT_MAX_LENGTH && typeof row.spoiler === 'boolean'
    && count(row.createdAt) && typeof row.deleted === 'boolean' && count(row.likes) && typeof row.liked === 'boolean'
    && typeof row.canDelete === 'boolean' && count(row.replyCount)
    && (row.replies === undefined || (withReplies && Array.isArray(row.replies) && row.replies.length <= REPLY_PREVIEW_SIZE && row.replies.every(reply => isComment(reply)))));
}
export function isReactionSummary(value) {
  return Boolean(value && typeof value === 'object' && value.reactions && typeof value.reactions === 'object'
    && COMMENT_MOODS.every(item => count(value.reactions[item.key])) && (value.myReaction === null || COMMENT_MOODS.some(item => item.key === value.myReaction)));
}
export function isRepliesPage(value) {
  return Boolean(value && typeof value === 'object' && Array.isArray(value.comments) && value.comments.length <= COMMENT_PAGE_SIZE
    && value.comments.every(row => isComment(row, true)) && count(value.total) && positive(value.page) && positive(value.pages) && value.page <= value.pages);
}
export const isCommentPage = value => isRepliesPage(value) && isReactionSummary(value);
