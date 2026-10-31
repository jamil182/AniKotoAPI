import { AccountError } from './accountError.js';
import { COMMENT_MAX_LENGTH, COMMENT_MOODS } from '../../public/assets/comment-data.js';
import { commentMedia } from '../../public/assets/comment-media-data.js';

export function commentSlug(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,239}$/i.test(value)) throw new AccountError('Slug anime tidak valid.');
  return value;
}
export function commentEpisode(value, all = false) {
  if (all && value === 'all') return 'all';
  if (!['string', 'number'].includes(typeof value) || !/^\d{1,6}(?:\.\d{1,3})?$/.test(String(value))) throw new AccountError('Episode komentar tidak valid.');
  const number = Number(value);
  if (!Number.isFinite(number) || number > 100000) throw new AccountError('Episode komentar tidak valid.');
  return number;
}
export function commentId(value) {
  if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d{0,14}$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new AccountError('ID komentar tidak valid.');
  return Number(value);
}
export function commentPage(value = '1') {
  const page = commentId(value);
  if (page > 1000000) throw new AccountError('Halaman komentar tidak valid.');
  return page;
}
export function commentSort(value = 'newest') {
  if (!['newest', 'oldest', 'popular'].includes(value)) throw new AccountError('Urutan komentar tidak valid.');
  return value;
}
export function commentObject(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) throw new AccountError('Data komentar tidak valid.');
  return body;
}
/** @param {unknown} body @returns {import('../../public/assets/comments.types.js').CommentDraft} */
export function commentDraft(body) {
  const input = commentObject(body, ['slug', 'episode', 'body', 'spoiler', 'parentId', 'requestId', 'media']);
  const media = commentMedia(input.media);
  if (input.media !== undefined && input.media !== null && !media) throw new AccountError('Lampiran komentar tidak valid.');
  if (typeof input.body !== 'string') throw new AccountError('Isi komentar tidak valid.');
  const text = input.body.replace(/\r\n?/g, '\n').trim();
  if ((!text.replace(/[\p{Cf}\s]/gu, '') && !media) || text.length > COMMENT_MAX_LENGTH || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new AccountError('Isi komentar atau pilih GIF/gambar; maksimal 4.000 karakter.');
  if (typeof input.spoiler !== 'boolean' || typeof input.requestId !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(input.requestId)) throw new AccountError('Data komentar tidak valid.');
  return { slug: commentSlug(input.slug), episode: commentEpisode(input.episode), body: text, spoiler: input.spoiler, media,
    parentId: input.parentId === null || input.parentId === undefined ? null : commentId(input.parentId), requestId: input.requestId };
}
export function commentMood(value) {
  if (value !== null && !COMMENT_MOODS.some(item => item.key === value)) throw new AccountError('Reaksi tidak valid.');
  return value;
}
