import { Router } from 'express';
import { createHash } from 'node:crypto';
import { translatePlainText, PROVIDER } from '../helper/translate.helper.js';
import { seoSlug } from '../services/seo.js';
import { AniKotoError } from '../services/anikotoApi.js';

/** @param {() => import('better-sqlite3').Database} getDatabase
 * @param {ReturnType<import('../services/anikotoApi.js').createAniKotoClient>} client
 * @param {ReturnType<import('../services/publishedCatalog.js').createPublishedCatalog> | null} [catalog]
 * @param {{translate?: typeof translatePlainText, provider?: string, now?: () => number}} [options] */
export function createSynopsisTranslationRouter(getDatabase, client, catalog = null, { translate=translatePlainText, provider=PROVIDER, now=Date.now }={}) {
  const router=Router();
  /** @type {Map<string, {expires: number, error: boolean}>} */ const jobs=new Map();
  let active=0, loading=0;
  router.get('/:slug', async (req,res) => {
    res.set('Cache-Control','no-store');
    const fail=(status,message,retry=30)=>res.status(status).set('Retry-After',String(retry)).json({success:false,message});
    let slug;
    try { slug=seoSlug(req.params.slug); if (req.query.lang !== 'id') return fail(400,'Unsupported language'); if (catalog) catalog.require(slug); }
    catch { return fail(404,'Anime not found'); }
    if (loading>=8) return fail(503,'Synopsis translation is busy');
    loading++;
    try {
      const anime=await (catalog ? catalog.description(slug) : client.get('/info',{id:slug}));
      if (!anime || !anime.title) return fail(404,'Anime not found');
      const raw=anime.synopsis || anime.description;
      const source=typeof raw==='string' ? raw.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim() : '';
      if (source.length>6000) return fail(413,'Synopsis is too long to translate');
      if (!source) return res.json({success:true,results:{text:'',language:'id',status:'unavailable'}});
      const key=createHash('sha256').update(JSON.stringify(['v1','en','id',provider,source])).digest('hex');
      const db=getDatabase(), cached=db.prepare('SELECT translated_text FROM synopsis_translations WHERE cache_key=?').get(key);
      if (cached) return res.json({success:true,results:{text:cached.translated_text,language:'id',status:'ready'}});
      for (const [id,job] of jobs) if (job.expires && job.expires<=now()) jobs.delete(id);
      const previous=jobs.get(key);
      if (previous?.error) return fail(503,'Synopsis translation is temporarily unavailable',60);
      if (!previous) {
        if (active>=2 || jobs.size>=16) return fail(503,'Synopsis translation is busy',5);
        const job={expires:0,error:false};jobs.set(key,job);active++;
        void (async()=>{
          try {
            const result=await translate(source,{signal:AbortSignal.timeout(180000)});
            if (typeof result.text!=='string' || !result.text.trim() || result.text.length>24000) throw new Error('Invalid translation');
            db.transaction(()=>{
              db.prepare('INSERT OR REPLACE INTO synopsis_translations(cache_key,translated_text,created_at) VALUES (?,?,?)').run(key,result.text,now());
              db.prepare('DELETE FROM synopsis_translations WHERE cache_key NOT IN (SELECT cache_key FROM synopsis_translations ORDER BY created_at DESC LIMIT 2000)').run();
            })();
            jobs.delete(key);
          } catch { job.error=true;job.expires=now()+60000; }
          finally { active--; }
        })();
      }
      return res.status(202).set('Retry-After','3').json({success:true,results:{status:'translating',language:'id'}});
    } catch (error) { return fail(error instanceof AniKotoError && error.status===404 ? 404 : 503,'Synopsis translation is temporarily unavailable'); }
    finally { loading--; }
  });
  return router;
}
