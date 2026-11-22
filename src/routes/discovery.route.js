import { Router } from 'express';
import { searchFilters } from '../../public/assets/search-filters.js';
import { AniKotoError } from '../services/anikotoApi.js';

/** @param {{discover?: (filters: import('../../public/assets/search-filters.types.js').SearchFilters) => Promise<unknown>}} client
 * @param {object | null} [catalog] */
export function createDiscoveryRouter(client, catalog = null) {
  const router = Router();
  router.get('/',async (req,res) => {
    res.set('Cache-Control','no-store');
    let filters;
    try { filters=searchFilters(req.query,{strict:true}); }
    catch(error) { return res.status(400).json({success:false,message:error.message}); }
    if (catalog || typeof client.discover !== 'function') return res.status(503).json({success:false,message:'Advanced search requires the Miruro catalog.'});
    try { res.json({success:true,results:await client.discover(filters)}); }
    catch(error) { res.status(error instanceof AniKotoError ? error.status : 503).set('Retry-After',String(error.retryAfter || '60')).json({success:false,message:'Search is temporarily unavailable. Please retry shortly.'}); }
  });
  return router;
}
