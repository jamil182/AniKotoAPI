import { AccountError } from '../services/accountError.js';
import { COMMENT_MOODS, COMMENT_PAGE_SIZE, REPLY_PREVIEW_SIZE } from '../../public/assets/comment-data.js';

/** @param {import('better-sqlite3').Database} db */
export function createCommentsRepository(db) {
  const get = db.prepare('SELECT * FROM anime_comments WHERE id = ?');
  const existing = db.prepare('SELECT * FROM anime_comments WHERE user_id = ? AND request_id = ?');
  const projection = `c.*, a.display_name,
    CASE WHEN c.deleted_at IS NULL THEN (SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id = c.id) ELSE 0 END AS like_count,
    EXISTS(SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.user_id = @viewer) AS viewer_liked,
    (SELECT COUNT(*) FROM anime_comments r WHERE r.parent_id = c.id AND r.deleted_at IS NULL) AS reply_count`;
  const dto = (row, viewer) => ({ id: row.id, animeSlug: row.anime_slug, episode: row.episode, parentId: row.parent_id,
    author: row.deleted_at === null ? row.display_name : 'Komentar dihapus', body: row.deleted_at === null ? row.body : '',
    spoiler: Boolean(row.spoiler), createdAt: row.created_at, deleted: row.deleted_at !== null,
    likes: row.deleted_at === null ? row.like_count : 0, liked: row.deleted_at === null && Boolean(row.viewer_liked),
    canDelete: row.deleted_at === null && row.user_id === viewer, replyCount: row.reply_count });
  const selectOne = db.prepare(`SELECT ${projection} FROM anime_comments c JOIN user_accounts a ON a.id=c.user_id WHERE c.id=@id`);
  const reactionCounts = db.prepare('SELECT mood, COUNT(*) AS total FROM anime_reactions WHERE anime_slug=? GROUP BY mood');
  const ownReaction = db.prepare('SELECT mood FROM anime_reactions WHERE anime_slug=? AND user_id=?');
  const reactions = (slug, viewer) => ({ reactions: Object.fromEntries(COMMENT_MOODS.map(item => [item.key, 0]).concat(reactionCounts.all(slug).map(row => [row.mood, row.total]))), myReaction: viewer ? ownReaction.get(slug, viewer)?.mood || null : null });
  const one = (id, viewer) => dto(selectOne.get({ id, viewer }), viewer);
  const rootVisible = '(c.deleted_at IS NULL OR EXISTS(SELECT 1 FROM anime_comments child WHERE child.parent_id=c.id AND child.deleted_at IS NULL))';
  return {
    get: id => get.get(id),
    existing: (user, request) => existing.get(user, request),
    list({ slug, episode, page, sort, viewer = null }) {
      const where = 'c.anime_slug=@slug' + (episode === 'all' ? '' : ' AND c.episode=@episode');
      const params = { slug, ...(episode === 'all' ? {} : { episode }) };
      const total = db.prepare(`SELECT COUNT(*) AS n FROM anime_comments c WHERE ${where} AND c.deleted_at IS NULL`).get(params).n;
      const rootCount = db.prepare(`SELECT COUNT(*) AS n FROM anime_comments c WHERE ${where} AND c.parent_id IS NULL AND ${rootVisible}`).get(params).n;
      const pages = Math.max(1, Math.ceil(rootCount / COMMENT_PAGE_SIZE));
      page = Math.min(page, pages);
      const order = { newest: 'c.created_at DESC,c.id DESC', oldest: 'c.created_at,c.id', popular: 'like_count DESC,c.created_at DESC,c.id DESC' }[sort];
      const roots = db.prepare(`SELECT ${projection} FROM anime_comments c JOIN user_accounts a ON a.id=c.user_id
        WHERE ${where} AND c.parent_id IS NULL AND ${rootVisible} ORDER BY ${order} LIMIT @limit OFFSET @offset`)
        .all({ ...params, viewer, limit: COMMENT_PAGE_SIZE, offset: (page - 1) * COMMENT_PAGE_SIZE }).map(row => dto(row, viewer));
      const replyStatement = db.prepare(`SELECT ${projection} FROM anime_comments c JOIN user_accounts a ON a.id=c.user_id
        WHERE c.parent_id=@id AND c.deleted_at IS NULL ORDER BY c.created_at,c.id LIMIT @limit`);
      for (const root of roots) root.replies = replyStatement.all({ id: root.id, viewer, limit: REPLY_PREVIEW_SIZE }).map(row => dto(row, viewer));
      return { comments: roots, total, page, pages, ...reactions(slug, viewer) };
    },
    replies(id, page, viewer = null) {
      const total = db.prepare('SELECT COUNT(*) AS n FROM anime_comments WHERE parent_id=? AND deleted_at IS NULL').get(id).n;
      const pages = Math.max(1, Math.ceil(total / COMMENT_PAGE_SIZE)); page = Math.min(page, pages);
      const rows = db.prepare(`SELECT ${projection} FROM anime_comments c JOIN user_accounts a ON a.id=c.user_id
        WHERE c.parent_id=@id AND c.deleted_at IS NULL ORDER BY c.created_at,c.id LIMIT @limit OFFSET @offset`)
        .all({ id, viewer, limit: COMMENT_PAGE_SIZE, offset: (page - 1) * COMMENT_PAGE_SIZE }).map(row => dto(row, viewer));
      return { comments: rows, total, page, pages };
    },
    create: db.transaction((draft, user, now) => {
      const prior = existing.get(user, draft.requestId);
      if (prior) {
        if (prior.anime_slug !== draft.slug || prior.episode !== draft.episode || prior.body !== draft.body || prior.parent_id !== draft.parentId || Boolean(prior.spoiler) !== draft.spoiler) throw new AccountError('ID pengiriman sudah dipakai untuk komentar lain.', 409);
        return one(prior.id, user);
      }
      if (draft.parentId !== null) {
        const parent = get.get(draft.parentId);
        if (!parent || parent.deleted_at !== null || parent.parent_id !== null || parent.anime_slug !== draft.slug || parent.episode !== draft.episode) throw new AccountError('Balasan harus berada pada komentar utama dan episode yang sama.', 400);
      }
      const recent = db.prepare('SELECT created_at FROM anime_comments WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 1').get(user);
      const minute = db.prepare('SELECT COUNT(*) AS n, MIN(created_at) AS first FROM anime_comments WHERE user_id=? AND created_at>?').get(user, now - 60000);
      const hour = db.prepare('SELECT COUNT(*) AS n, MIN(created_at) AS first FROM anime_comments WHERE user_id=? AND created_at>?').get(user, now - 3600000);
      const retry = Math.max(recent ? 10000 - (now - recent.created_at) : 0, minute.n >= 5 ? minute.first + 60000 - now : 0, hour.n >= 30 ? hour.first + 3600000 - now : 0);
      if (retry > 0) { const error = new AccountError('Terlalu cepat mengirim komentar. Silakan tunggu sebentar.', 429); error.retryAfter = Math.ceil(retry / 1000); throw error; }
      const result = db.prepare(`INSERT INTO anime_comments (anime_slug,episode,user_id,parent_id,body,spoiler,request_id,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(draft.slug, draft.episode, user, draft.parentId, draft.body, Number(draft.spoiler), draft.requestId, now);
      return one(Number(result.lastInsertRowid), user);
    }),
    like: db.transaction((id, user, liked) => {
      const row = get.get(id);
      if (!row || row.deleted_at !== null) throw new AccountError('Komentar tidak ditemukan.', 404);
      if (liked) db.prepare('INSERT OR IGNORE INTO comment_likes (comment_id,user_id) VALUES (?,?)').run(id, user);
      else db.prepare('DELETE FROM comment_likes WHERE comment_id=? AND user_id=?').run(id, user);
      return one(id, user);
    }),
    react: db.transaction((slug, user, mood) => {
      if (mood === null) db.prepare('DELETE FROM anime_reactions WHERE anime_slug=? AND user_id=?').run(slug, user);
      else db.prepare('INSERT INTO anime_reactions (anime_slug,user_id,mood) VALUES (?,?,?) ON CONFLICT(anime_slug,user_id) DO UPDATE SET mood=excluded.mood').run(slug, user, mood);
      return reactions(slug, user);
    }),
    remove(id, user, now) {
      const result = db.prepare('UPDATE anime_comments SET deleted_at=COALESCE(deleted_at,?), deleted_by_admin=0 WHERE id=? AND user_id=? AND (deleted_at IS NULL OR deleted_by_admin=1)').run(now, id, user);
      if (!result.changes) throw new AccountError('Komentar tidak ditemukan atau bukan milik Anda.', 404);
    },
    moderate(id, hidden, now) {
      const row = get.get(id);
      if (!row) throw new AccountError('Komentar tidak ditemukan.', 404);
      if (hidden && row.deleted_at === null) db.prepare('UPDATE anime_comments SET deleted_at=?,deleted_by_admin=1 WHERE id=?').run(now, id);
      if (!hidden && row.deleted_at !== null) {
        if (!row.deleted_by_admin) throw new AccountError('Komentar yang dihapus penulis tidak dipulihkan oleh admin.', 409);
        db.prepare('UPDATE anime_comments SET deleted_at=NULL,deleted_by_admin=0 WHERE id=?').run(id);
      }
    },
    moderation({ page, state, slug }) {
      const where = [state === 'visible' ? 'c.deleted_at IS NULL' : state === 'hidden' ? 'c.deleted_at IS NOT NULL' : '1=1', ...(slug ? ['c.anime_slug=@slug'] : [])].join(' AND ');
      const params = slug ? { slug } : {};
      const total = db.prepare(`SELECT COUNT(*) AS n FROM anime_comments c WHERE ${where}`).get(params).n;
      const pages = Math.max(1, Math.ceil(total / COMMENT_PAGE_SIZE)); page = Math.min(page, pages);
      const comments = db.prepare(`SELECT c.id,c.anime_slug AS animeSlug,c.episode,c.parent_id AS parentId,c.body,a.display_name AS author,
        c.created_at AS createdAt,c.deleted_at AS deletedAt,c.deleted_by_admin AS deletedByAdmin
        FROM anime_comments c JOIN user_accounts a ON a.id=c.user_id WHERE ${where} ORDER BY c.id DESC LIMIT @limit OFFSET @offset`)
        .all({ ...params, limit: COMMENT_PAGE_SIZE, offset: (page - 1) * COMMENT_PAGE_SIZE });
      return { comments, total, page, pages };
    },
  };
}
