import { Router } from 'express';
import { createAccountService } from '../services/accounts.js';
import { readAccountCookie } from './accountCookies.js';
import { AccountError } from '../services/accountError.js';
import { createCommentsRepository } from '../db/comments.repo.js';
import { commentSlug, commentEpisode, commentId, commentPage, commentSort, commentObject, commentDraft, commentMood } from '../services/comments.input.js';
import { visitorAddress } from '../services/visitorAddress.js';
import { normalizeAnime, AniKotoError } from '../services/anikotoApi.js';
import { adminAuth } from '../middleware/adminAuth.js';

function jsonWrite(req, res, next) {
  if (req.method === 'GET') return next();
  let allowed = !req.get('origin');
  try { if (req.get('origin')) allowed = new URL(req.get('origin')).origin === req.protocol + '://' + req.get('host'); } catch { allowed = false; }
  if (!allowed || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ success: false, message: 'Permintaan lintas situs ditolak.' });
  if (!req.is('application/json')) return res.status(415).json({ success: false, message: 'Gunakan format JSON.' });
  next();
}
function route(router, method, path, action) {
  router[method](path, async (req, res) => {
    try { const value = await action(req, res); if (!res.headersSent) res.json({ success: true, results: value }); }
    catch (error) {
      if (error.retryAfter) res.setHeader('Retry-After', String(Math.max(1, Math.min(3600, Math.ceil(Number(error.retryAfter) || 60)))));
      res.status(error instanceof AccountError || error instanceof AniKotoError ? error.status : 500)
        .json({ success: false, message: error instanceof AccountError ? error.message : 'Layanan komentar belum tersedia. Silakan coba lagi.' });
    }
  });
}
/** @param {() => import('better-sqlite3').Database} getDatabase */
export function createCommentsRouter(getDatabase, client, catalog = null, { now = Date.now, maxWrites = 120 } = {}) {
  const router = Router(), accounts = createAccountService(getDatabase, { now }), attempts = new Map();
  let repository;
  const repo = () => repository ||= createCommentsRepository(getDatabase());
  const visible = slug => { if (catalog) catalog.require(slug); };
  const row = id => { const value = repo().get(id); if (!value) throw new AccountError('Komentar tidak ditemukan.', 404); visible(value.anime_slug); return value; };
  async function realAnime(slug, episode = 0) {
    if (catalog) {
      catalog.require(slug);
      if (episode > 0 && !catalog.episodes(slug).episodes.some(item => Number(item.episode_no) === episode)) throw new AccountError('Episode tidak ditemukan.', 404);
      return;
    }
    const [info, episodeRows] = await Promise.all([client.get('/info', { id: slug }), episode > 0 ? client.get('/episodes/' + slug) : null]);
    const anime = normalizeAnime(info);
    if (!anime || !info?.title || anime.slug !== slug) throw new AccountError('Anime tidak ditemukan.', 404);
    if (episode > 0) {
      if (!Array.isArray(episodeRows?.episodes) || !episodeRows.episodes.some(item => Number(item.episode_no) === episode)) throw new AccountError('Episode tidak ditemukan.', 404);
    }
  }
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.locals.viewer = accounts.current(readAccountCookie(req))?.id || null;
    if (req.method !== 'GET' && !res.locals.viewer) return res.status(401).json({ success: false, message: 'Silakan login untuk mengirim komentar atau reaksi.' });
    next();
  });
  router.use(jsonWrite);
  router.use((req, res, next) => {
    if (req.method === 'GET') return next();
    const time = now();
    for (const [key, item] of attempts) if (item.until <= time) attempts.delete(key);
    const key = visitorAddress(req) || req.ip;
    const attempt = attempts.get(key) || { count: 0, until: time + 60000 };
    if (attempt.count >= maxWrites || (!attempts.has(key) && attempts.size >= 1000)) return res.status(429).set('Retry-After', '60').json({ success: false, message: 'Terlalu banyak aktivitas. Silakan tunggu sebentar.' });
    attempt.count++; attempts.set(key, attempt); next();
  });
  route(router, 'get', '/', (req, res) => {
    const slug = commentSlug(req.query.slug); visible(slug);
    return repo().list({ slug, episode: commentEpisode(req.query.episode ?? '0', true), page: commentPage(req.query.page), sort: commentSort(req.query.sort), viewer: res.locals.viewer });
  });
  route(router, 'post', '/', async (req, res) => {
    const draft = commentDraft(req.body); visible(draft.slug);
    if (!repo().existing(res.locals.viewer, draft.requestId)) await realAnime(draft.slug, draft.episode);
    const result = repo().create(draft, res.locals.viewer, now());
    res.status(201); return result;
  });
  route(router, 'put', '/reaction', async (req, res) => {
    const body = commentObject(req.body, ['slug', 'mood']), slug = commentSlug(body.slug), mood = commentMood(body.mood);
    await realAnime(slug); return repo().react(slug, res.locals.viewer, mood);
  });
  route(router, 'get', '/:id/replies', (req, res) => {
    const id = commentId(req.params.id), parent = row(id);
    if (parent.parent_id !== null) throw new AccountError('Balasan hanya tersedia pada komentar utama.');
    return repo().replies(id, commentPage(req.query.page), res.locals.viewer);
  });
  route(router, 'put', '/:id/like', (req, res) => {
    const id = commentId(req.params.id); row(id);
    const body = commentObject(req.body, ['liked']);
    if (typeof body.liked !== 'boolean') throw new AccountError('Status suka tidak valid.');
    return repo().like(id, res.locals.viewer, body.liked);
  });
  route(router, 'delete', '/:id', (req, res) => {
    commentObject(req.body, []); repo().remove(commentId(req.params.id), res.locals.viewer, now()); return { deleted: true };
  });
  return router;
}

/** @param {() => import('better-sqlite3').Database} getDatabase */
export function createCommentsModerationRouter(getDatabase, { now = Date.now } = {}) {
  const router = Router(); let repository;
  const repo = () => repository ||= createCommentsRepository(getDatabase());
  router.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use(adminAuth, jsonWrite);
  route(router, 'get', '/', req => {
    const state = req.query.state || 'visible';
    if (!['all', 'visible', 'hidden'].includes(state)) throw new AccountError('Filter moderasi tidak valid.');
    return repo().moderation({ state, page: commentPage(req.query.page), slug: req.query.slug ? commentSlug(req.query.slug) : null });
  });
  route(router, 'patch', '/:id', req => {
    const body = commentObject(req.body, ['hidden']);
    if (typeof body.hidden !== 'boolean') throw new AccountError('Status moderasi tidak valid.');
    repo().moderate(commentId(req.params.id), body.hidden, now()); return { hidden: body.hidden };
  });
  return router;
}
