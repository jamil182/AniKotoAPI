import { createHmac, randomBytes } from 'node:crypto';
import { createVisitorGeo } from './visitorGeo.js';

export const ONLINE_MS = 90_000;
const VISIT_MS = 1_800_000;
const DAY_MS = 86_400_000;
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayOf = time => dayFormat.format(new Date(time));

/** @param {unknown} body @returns {import('./visitors.types.js').VisitorEvent | null} */
export function visitorEvent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { path, eventId, type } = body;
  if (typeof path !== 'string' || path.length > 300 || !['view', 'heartbeat'].includes(type)
    || typeof eventId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(eventId)) return null;
  if (!/^(?:\/|\/(?:home|browse|schedule|privacy|tos)(?:\.html)?|\/(?:anime|watch)\/[a-z0-9][a-z0-9_-]{0,239}(?:\/\d+(?:\.\d+)?)?)$/i.test(path)) return null;
  return { path, eventId, type };
}

/** @param {() => import('better-sqlite3').Database} getDatabase
 * @param {{now?: () => number, geo?: ReturnType<typeof createVisitorGeo>}} options
 */
export function createVisitorService(getDatabase, { now = Date.now, geo = createVisitorGeo({ enabled: process.env.VISITOR_GEO_LOOKUP !== 'false' }) } = {}) {
  let lastCleanup = 0;
  const pending = new Set();
  const initialized = new WeakSet();
  function database() {
    const db = getDatabase();
    if (!initialized.has(db)) {
      db.prepare('INSERT OR IGNORE INTO visitor_settings(id,secret,started_at) VALUES(1,?,?)').run(randomBytes(32).toString('hex'), now());
      initialized.add(db);
    }
    return db;
  }
  function cleanup(db, time) {
    if (lastCleanup && time - lastCleanup < 3_600_000) return;
    db.prepare('DELETE FROM visitors WHERE last_seen < ?').run(time - 30 * DAY_MS);
    db.prepare('DELETE FROM visitor_events WHERE created_at < ?').run(time - 2 * DAY_MS);
    db.prepare('DELETE FROM visitor_daily_seen WHERE day < ?').run(dayOf(time - 2 * DAY_MS));
    lastCleanup = time;
  }
  function locate(db, id, ip, time) {
    const row = db.prepare('SELECT geo_at FROM visitors WHERE id=?').get(id);
    if (!row || row.geo_at > time || pending.has(id) || pending.size >= 100) return;
    db.prepare('UPDATE visitors SET geo_at=? WHERE id=?').run(time + 300_000, id);
    pending.add(id);
    geo.lookup(ip).then(location => {
      db.prepare('UPDATE visitors SET country=?,region=?,city=?,geo_status=?,geo_at=? WHERE id=? AND ip=?').run(
        location.country, location.region, location.city, location.status,
        time + (['resolved', 'local', 'disabled'].includes(location.status) ? DAY_MS : 300_000), id, ip);
    }).catch(() => { /* A lookup failure must never interrupt playback or statistics. */ }).finally(() => pending.delete(id));
  }
  return {
    /** @param {string} ip @param {string} agent @param {import('./visitors.types.js').VisitorEvent} event */
    record(ip, agent, event) {
      const db = database(), time = now(), day = dayOf(time);
      const { secret } = db.prepare('SELECT secret FROM visitor_settings WHERE id=1').get();
      const id = createHmac('sha256', secret).update(ip + '\n' + agent.slice(0, 512)).digest('hex');
      const result = db.transaction(() => {
        cleanup(db, time);
        const known = db.prepare('SELECT last_seen FROM visitors WHERE id=?').get(id);
        const seenEvent = db.prepare('SELECT 1 FROM visitor_events WHERE visitor_id=? AND event_id=?').get(id, event.eventId);
        if (event.type === 'heartbeat' && !seenEvent) return { needsView: true };
        const view = event.type === 'view' && !seenEvent ? 1 : 0;
        // Repeated heartbeats from multiple tabs share one visitor and one write window.
        if (!view && known && time - known.last_seen < 15_000) return { needsView: false };
        const visit = !known || time - known.last_seen >= VISIT_MS ? 1 : 0;
        db.prepare(`INSERT INTO visitors(id,ip,path,first_seen,last_seen,views) VALUES(?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET path=excluded.path,last_seen=excluded.last_seen,views=visitors.views+excluded.views`).run(id, ip, event.path, time, time, view);
        if (view) db.prepare('INSERT INTO visitor_events(visitor_id,event_id,created_at) VALUES(?,?,?)').run(id, event.eventId, time);
        const unique = db.prepare('INSERT OR IGNORE INTO visitor_daily_seen(day,visitor_id) VALUES(?,?)').run(day, id).changes;
        db.prepare(`INSERT INTO visitor_daily(day,visitors,visits,pageviews) VALUES(?,?,?,?)
          ON CONFLICT(day) DO UPDATE SET visitors=visitors+excluded.visitors,visits=visits+excluded.visits,pageviews=pageviews+excluded.pageviews`).run(day, unique, visit, view);
        db.prepare('UPDATE visitor_settings SET visits=visits+?,pageviews=pageviews+? WHERE id=1').run(visit, view);
        return { needsView: false };
      })();
      if (!result.needsView) locate(db, id, ip, time);
      return result;
    },
    /** @param {number} page @returns {import('./visitors.types.js').VisitorStats} */
    stats(page = 1) {
      const db = database(), time = now();
      cleanup(db, time);
      const settings = db.prepare('SELECT started_at,visits,pageviews FROM visitor_settings WHERE id=1').get();
      const { total } = db.prepare('SELECT COUNT(*) AS total FROM visitors').get();
      const { online } = db.prepare('SELECT COUNT(*) AS online FROM visitors WHERE last_seen >= ?').get(time - ONLINE_MS);
      const pages = Math.max(1, Math.ceil(total / 20));
      page = Math.min(page, pages);
      const visitors = db.prepare(`SELECT ip,path,first_seen AS firstSeen,last_seen AS lastSeen,views,country,region,city,geo_status AS status
        FROM visitors ORDER BY last_seen DESC,id LIMIT 20 OFFSET ?`).all((page - 1) * 20).map(row => ({ ...row, online: row.lastSeen >= time - ONLINE_MS }));
      const daily = Array.from({ length: 7 }, (_, index) => {
        const day = dayOf(time - (6 - index) * DAY_MS);
        return db.prepare('SELECT day,visitors,visits,pageviews FROM visitor_daily WHERE day=?').get(day) || { day, visitors: 0, visits: 0, pageviews: 0 };
      });
      const { day: todayDay, ...today } = daily.at(-1);
      return { startedAt: settings.started_at, generatedAt: time, onlineWindowSeconds: ONLINE_MS / 1000,
        totals: { visits: settings.visits, pageviews: settings.pageviews }, today, online, page, pages, total, visitors, daily };
    },
  };
}
