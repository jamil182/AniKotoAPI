import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AniKotoError } from '../services/anikotoApi.js';
import { createSeoCatalog, seoBrowse, seoConfiguration } from '../services/seo.js';
import { renderSeo, seoAnimeBody, seoEscape, seoImage, seoLinks, seoText, sitemapXml } from '../services/seoRender.js';
import { CATALOG_VIEWS } from '../../public/assets/catalog-sources.js';

const staticPaths = ['/', '/home', '/browse', '/schedule', '/privacy', '/tos'];
/** @param {{publicDir: string, client: ReturnType<import('../services/anikotoApi.js').createAniKotoClient>,
 * catalog?: ReturnType<import('../services/publishedCatalog.js').createPublishedCatalog> | null,
 * config?: import('../services/seo.types.js').SeoConfiguration}} options */
export function createSeoRouter({ publicDir, client, catalog = null, config = seoConfiguration() }) {
  const router = Router(), data = createSeoCatalog(client, catalog);
  /** @param {import('express').Response} res @param {unknown} error */
  function failure(res, error) {
    const status = error instanceof AniKotoError && [400,404].includes(error.status) ? error.status : 503;
    res.set('Cache-Control','no-store').set('X-Robots-Tag','noindex, follow');
    if (status === 503) res.set('Retry-After','60');
    const title = status === 404 ? 'Page not found' : status === 400 ? 'Invalid page' : 'Catalog temporarily unavailable';
    return res.status(status).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — ${seoEscape(config.name)}</title></head><body><main><h1>${title}</h1><p>${status === 503 ? 'Please try again shortly.' : 'Please check the address.'}</p><a href="/home">Home</a></main></body></html>`);
  }
  router.use((req,res,next) => {
    if (/^\/(?:api(?:\/|$)|admin(?:\/|$)|account(?:\/|$)|login(?:\/|$)|register(?:\/|$)|docs(?:\/|$)|watch(?:\/|$))/.test(req.path)
      || /\.html\/?$/i.test(req.path)) res.set('X-Robots-Tag','noindex, follow');
    const clean = req.path.replace(/\/+$/, '').toLowerCase() || '/';
    if (req.path !== clean && staticPaths.includes(clean)) return res.redirect(301, clean + (req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''));
    next();
  });
  router.get('/robots.txt', (_req,res) => res.type('text/plain').set('Cache-Control','public, max-age=300').send(
    `User-agent: *\nAllow: /\nDisallow: /api/admin\nDisallow: /api/auth/\nDisallow: /api/stream/\nDisallow: /api/comments\nDisallow: /.git\nDisallow: /.env\n\nSitemap: ${config.origin}/sitemap.xml\n`));
  /** @param {string} route @param {(req: import('express').Request) => Promise<string>} build */
  function xml(route, build) {
    router.get(route, async (req,res) => {
      try { res.type('application/xml').set('Cache-Control','public, max-age=300').send(await build(req)); }
      catch (error) { failure(res,error); }
    });
  }
  xml('/sitemap.xml', async () => {
    const first = await data.page();
    return sitemapXml(['/sitemap-pages.xml', ...Array.from({length:first.totalPages}, (_value,index) => '/sitemap-anime-' + (index+1) + '.xml')], config.origin, true);
  });
  xml('/sitemap-pages.xml', async () => sitemapXml(staticPaths,config.origin));
  xml('/sitemap-anime-:page.xml', async req => {
    if (!/^[1-9]\d{0,3}$/.test(req.params.page)) throw new AniKotoError('Sitemap not found',404);
    const page = await data.page(new URLSearchParams({page:req.params.page}));
    return sitemapXml(page.data.map(anime => '/anime/' + encodeURIComponent(anime.slug)),config.origin);
  });
  router.get('/anime/:slug', async (req,res) => {
    try {
      const detail = await data.detail(req.params.slug), anime = detail.anime;
      const canonical = '/anime/' + encodeURIComponent(anime.slug);
      if (req.params.slug !== anime.slug || req.path.endsWith('/')) return res.redirect(301,canonical);
      let template = await readFile(path.join(publicDir,'anime.html'),'utf8');
      const body = seoAnimeBody(detail);
      template = template.replace(/(<div id="page">)[\s\S]*?(<\/div>\s*<section id="comments")/, (_match,open,close) => open + body + close);
      const description = seoText(anime.synopsis || anime.description) || `Discover ${anime.title}, its synopsis, anime details, and available episodes on ${config.name}.`;
      const image = seoImage(anime.poster);
      const schema = [
        { '@type':anime.type?.toLowerCase() === 'movie' ? 'Movie' : 'CreativeWorkSeries', '@id':config.origin+canonical+'#anime',
          name:anime.title, url:config.origin+canonical, description,
          ...(image ? {image} : {}), ...(anime.genres.length ? {genre:anime.genres} : {}) },
        { '@type':'BreadcrumbList', itemListElement:[
          {'@type':'ListItem',position:1,name:'Home',item:config.origin+'/home'},
          {'@type':'ListItem',position:2,name:anime.title,item:config.origin+canonical},
        ] },
      ];
      res.type('html').set('Cache-Control','public, max-age=60').send(renderSeo(template,config,{title:anime.title,description,path:canonical,image:anime.poster,schema}));
    } catch (error) { failure(res,error); }
  });
  router.get(staticPaths, async (req,res) => {
    try {
      const file = {'/':'landing.html','/home':'index.html','/browse':'browse.html','/schedule':'schedule.html','/privacy':'privacy.html','/tos':'tos.html'}[req.path];
      let template = await readFile(path.join(publicDir,file),'utf8');
      const definitions = {
        '/': ['Discover Anime, Latest Episodes & Release Schedules', 'Discover anime on '+config.name+'. Browse the latest episodes, popular series, anime details, and weekly release schedules.'],
        '/home':['Latest Anime Episodes & Popular Series','Explore the latest anime episodes, popular series, and newly added titles on '+config.name+'. Find your next anime and follow episode updates.'],
        '/browse':['All Anime','Browse anime series and movies on '+config.name+'. Discover titles by genre, type, and release status.'],
        '/schedule':['Weekly Anime Schedule','Check upcoming anime episode releases with the weekly schedule on '+config.name+'. View release times in your local timezone.'],
        '/privacy':['Privacy Policy','Read how '+config.name+' handles account information, comments, visitor statistics, and privacy.'],
        '/tos':['Terms of Service','Read the terms for using '+config.name+', including account access, comments, and third-party playback services.'],
      };
      let [title, description] = definitions[req.path], canonical = req.path;
      if (['/','/home','/browse'].includes(req.path)) {
        const checked = req.path === '/browse' ? seoBrowse(req.query) : seoBrowse({});
        const listing = await data.page(checked.params);
        const links = seoLinks(listing.data);
        if (req.path === '/home') template = template.replace('<div id="latest"></div>', () => '<div id="latest">'+links+'</div>');
        else if (req.path === '/') template = template.replace('<p class="landing-foot">', () => '<h2>Explore the latest anime</h2>'+links+'<p class="landing-foot">');
        else {
          title = CATALOG_VIEWS[checked.source].title;
          if (checked.params.has('genre')) title = checked.params.get('genre').replace(/-/g,' ') + ' Anime';
          if (checked.params.has('type')) title = checked.params.get('type').toUpperCase() + ' Anime';
          if (checked.params.has('letter')) title = 'Anime: ' + checked.params.get('letter').toUpperCase();
          if (checked.page > 1) title += ' — Page ' + checked.page;
          description = title + '. Browse anime titles, descriptions, and available episodes on '+config.name+'.';
          canonical += checked.params.size ? '?'+checked.params.toString() : '';
          const navigation = [-1,1].flatMap(offset => {
            const page = checked.page+offset;
            if (page < 1 || page > listing.totalPages) return [];
            const query = new URLSearchParams(checked.params); query.set('page',String(page));
            return [`<a href="/browse?${seoEscape(query.toString())}">${offset < 0 ? 'Previous page' : 'Next page'}</a>`];
          }).join(' · ');
          template = template.replace(/(<h1[^>]*id="browseTitle"[^>]*>)[\s\S]*?<\/h1>/, (_match,open) => open+seoEscape(title)+'</h1>');
          template = template.replace('<div id="catalogGrid"></div>', () => '<div id="catalogGrid">'+links+'</div>');
          template = template.replace(/(<nav[^>]*id="catalogPager"[^>]*>)[\s\S]*?<\/nav>/, (_match,open) => open+navigation+'</nav>');
        }
      }
      res.type('html').set('Cache-Control','public, max-age=60').send(renderSeo(template,config,{title,description,path:canonical}));
    } catch (error) { failure(res,error); }
  });
  return router;
}
