import { Router } from 'express';
import { adminAuth } from '../middleware/adminAuth.js';
import { createVisitorService, visitorEvent } from '../services/visitors.js';
import { visitorAddress } from '../services/visitorAddress.js';

/** @param {() => import('better-sqlite3').Database} getDatabase
 * @param {Parameters<typeof createVisitorService>[1]} options
 */
export function createVisitorsRouter(getDatabase, options = {}) {
  const router = Router(), service = createVisitorService(getDatabase, options);
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('CDN-Cache-Control', 'no-store');
    next();
  });
  router.post('/visit', (req, res) => {
    const origin = req.get('origin');
    if (req.get('sec-fetch-site') === 'cross-site' || (origin && origin !== `${req.protocol}://${req.get('host')}`)) {
      return res.status(403).json({ success: false, message: 'Permintaan lintas situs ditolak.' });
    }
    const event = visitorEvent(req.body), ip = visitorAddress(req), agent = req.get('user-agent') || '';
    if (!event || !ip) return res.status(400).json({ success: false, message: 'Data kunjungan tidak valid.' });
    if (/bot|crawler|spider|headless|preview|curl|wget/i.test(agent)) return res.json({ success: true, results: { ignored: true } });
    try { res.json({ success: true, results: service.record(ip, agent, event) }); }
    catch { res.status(503).json({ success: false, message: 'Pencatatan kunjungan sedang tidak tersedia.' }); }
  });
  router.get('/admin/visitors', adminAuth, (req, res) => {
    const page = req.query.page ?? '1';
    if (typeof page !== 'string' || !/^[1-9]\d{0,5}$/.test(page)) return res.status(400).json({ success: false, message: 'Halaman tidak valid.' });
    try { res.json({ success: true, results: service.stats(Number(page)) }); }
    catch { res.status(503).json({ success: false, message: 'Statistik sedang tidak tersedia.' }); }
  });
  return router;
}
