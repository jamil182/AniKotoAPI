import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { load } from 'cheerio';
import { createSeoRouter } from '../routes/seo.route.js';
import { createSeoCatalog, seoBrowse, seoConfiguration } from './seo.js';
import { renderSeo, seoLanding, seoLinks, sitemapXml } from './seoRender.js';
import { AniKotoError } from './anikotoApi.js';

const config = {origin:'https://aniyear.com',name:'Aniyear'};
const anime = {slug:'test-anime-123',title:'Ice & Fire $& <script>alert(1)</script>',poster:'https://images.example/poster.jpg',synopsis:'A story about friendship & adventure.',genres:['Adventure'],type:'TV'};
async function fixture(t, {broken=false, managed=false}={}) {
  const calls=[];
  const client={async get(endpoint,params) {
    calls.push({endpoint,params});
    if (broken) throw new AniKotoError('private upstream diagnostic',502);
    if (endpoint==='/info') {
      if (params.id==='missing') throw new AniKotoError('missing',404);
      return {...anime};
    }
    if (endpoint.startsWith('/episodes/')) return {episodes:[{episode_no:1,title:'First'},{episode_no:1},{episode_no:12.5},{episode_no:-1},{episode_no:'bad'}]};
    return {data:[{...anime,slug:Number(params.page)>1 ? 'second-anime' : anime.slug},{slug:'../invalid',title:'Invalid'}],totalPages:3};
  }};
  const catalog=managed ? {
    require(slug) {if(slug!=='published')throw new AniKotoError('draft',404);},
    description:async()=>({...anime,slug:'published'}),episodes:()=>({episodes:[]}),
    browse:()=>({data:[{...anime,slug:'published'}],totalPages:1}),
  } : null;
  const app=express();
  app.use(createSeoRouter({publicDir:fileURLToPath(new URL('../../public/',import.meta.url)),client,catalog,config}));
  app.use((_req,res)=>res.status(404).send('Not found'));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {calls,request:(url,options={})=>fetch(`http://127.0.0.1:${server.address().port}`+url,{redirect:'manual',...options})};
}

test('SEO configuration fixes the canonical origin and rejects unsafe operator settings',()=>{
  assert.deepEqual(seoConfiguration({}),config);
  for(const SITE_URL of ['http://example.com','https://user:secret@example.com','https://example.com/path','https://example.com/?x=1','https://example.com/#x']) assert.throws(()=>seoConfiguration({SITE_URL}));
  assert.throws(()=>seoConfiguration({SITE_NAME:'\n'}));
  assert.throws(()=>seoConfiguration({SITE_NAME:'a\u0000b'}));
  assert.equal(seoConfiguration({SITE_URL:'https://example.com/'}).origin,'https://example.com');
  for(const query of [{page:'0'},{page:['1','2']},{page:'10000'},{source:'invalid'},{genre:'../private'},{type:'script'},{letter:'ALL'}])assert.throws(()=>seoBrowse(query));
  assert.equal(seoBrowse({page:'1',source:'latest',utm_source:'test'}).params.toString(),'');
});

test('XML index covers every catalog page lazily, emits canonical anime URLs and avoids fake lastmod dates',async t=>{
  const f=await fixture(t);
  const response=await f.request('/sitemap.xml',{headers:{Host:'attacker.example','X-Forwarded-Host':'evil.example'}});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/xml/);
  const xml=await response.text(),$=load(xml,{xmlMode:true});
  assert.deepEqual($('loc').map((_i,el)=>$(el).text()).get(),['https://aniyear.com/sitemap-pages.xml',...Array.from({length:3},(_v,i)=>`https://aniyear.com/sitemap-anime-${i+1}.xml`)]);
  assert.equal(f.calls.length,1);assert.ok(!xml.includes('lastmod'));
  const child=await (await f.request('/sitemap-anime-1.xml')).text();
  assert.match(child,/https:\/\/aniyear.com\/anime\/test-anime-123/);
  assert.ok(!child.includes('/watch/'));assert.ok(!child.includes('invalid'));assert.equal(f.calls.length,1);
  assert.equal((await f.request('/sitemap-anime-3.xml')).status,200);
  for(const url of ['/sitemap-anime-0.xml','/sitemap-anime-4.xml','/sitemap-anime-10000.xml'])assert.equal((await f.request(url)).status,404);
  const pages=await(await f.request('/sitemap-pages.xml')).text();assert.match(pages,/\/schedule/);assert.ok(!pages.includes('/login'));
});

test('anime HTML contains visible safe content, unique metadata, JSON-LD and episode links before JavaScript',async t=>{
  const f=await fixture(t);
  const response=await f.request('/anime/test-anime-123?commentsEpisode=12.5&utm_source=test');
  assert.equal(response.status,200);
  const html=await response.text(),$=load(html);
  assert.equal($('title').text(),anime.title+' — Aniyear');
  assert.equal($('meta[name="description"]').attr('content'),anime.synopsis);
  assert.equal($('link[rel="canonical"]').attr('href'),'https://aniyear.com/anime/test-anime-123');
  assert.equal($('meta[property="og:title"]').length,1);assert.equal($('meta[name="twitter:card"]').attr('content'),'summary_large_image');
  assert.equal($('#animeDescription h1').text(),anime.title);assert.match($('#page').text(),/friendship/);
  assert.equal($('#episodeSection a').length,2);assert.equal($('#episodeSection a').last().attr('href'),'/watch/test-anime-123/12.5');
  assert.equal($('#comments').length,1);assert.equal($('#page script').length,0);
  const graph=JSON.parse($('script[type="application/ld+json"]').text())['@graph'];
  assert.equal(graph.find(row=>row['@type']==='CreativeWorkSeries').name,anime.title);
  assert.equal(graph.filter(row=>row['@type']==='BreadcrumbList').length,1);
  assert.ok(!html.includes('<script>alert(1)</script>'));assert.ok(!html.includes('aggregateRating'));
  assert.match($('script[src*="anime-page.js"]').attr('src'),/media-2/);
  assert.equal((await f.request('/anime/alias')).headers.get('location'),'/anime/test-anime-123');
  assert.equal((await f.request('/anime/test-anime-123/')).status,301);
});

test('home, landing and paginated browse expose crawlable links with clean canonical URLs',async t=>{
  const f=await fixture(t);
  for(const route of ['/','/home','/browse']) {
    const response=await f.request(route+'?utm_source=ignored');const $=load(await response.text());
    assert.equal(response.status,200);assert.equal($('link[rel="canonical"]').attr('href'),config.origin+route);
    assert.ok($('a[href="/anime/test-anime-123"]').length>0,route);
    assert.equal($('a[href="/anime/test-anime-123"]').first().text(),anime.title);
  }
  const response=await f.request('/browse?page=2&source=popular&unknown=ignored'),$=load(await response.text());
  assert.equal($('link[rel="canonical"]').attr('href'),'https://aniyear.com/browse?source=popular&page=2');
  assert.match($('title').text(),/Most Popular Anime — Page 2/);
  assert.equal($('#catalogGrid a').attr('href'),'/anime/second-anime');
  assert.equal($('#catalogPager a').length,2);
  for(const url of ['/schedule','/privacy','/tos'])assert.equal((await f.request(url)).status,200);
  assert.equal((await f.request('/browse?page=9999')).status,404);
  assert.equal((await f.request('/browse?page=1&page=2')).status,400);
  const trailing=await f.request('/browse/?page=2');assert.equal(trailing.status,301);assert.equal(trailing.headers.get('location'),'/browse?page=2');
});

test('missing anime are real 404s and upstream failures are retryable 503s without indexing an empty shell',async t=>{
  const good=await fixture(t),missing=await good.request('/anime/missing');assert.equal(missing.status,404);
  assert.match(missing.headers.get('x-robots-tag'),/noindex/);
  const broken=await fixture(t,{broken:true});
  for(const route of ['/sitemap.xml','/sitemap-anime-1.xml','/anime/test-anime-123','/home']){
    const response=await broken.request(route);assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'60');
    assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(!(await response.text()).includes('private upstream diagnostic'));
  }
  assert.equal((await broken.request('/sitemap-pages.xml')).status,200);
});

test('managed sitemaps exclude drafts and never fall back to the public upstream catalog',async t=>{
  const f=await fixture(t,{managed:true});
  const xml=await(await f.request('/sitemap-anime-1.xml')).text();assert.match(xml,/\/anime\/published/);
  assert.equal((await f.request('/anime/published')).status,200);assert.equal((await f.request('/anime/draft')).status,404);
  assert.equal(f.calls.length,0);
});

test('robots allows frontend resources and catalog data while private pages and APIs receive noindex headers',async t=>{
  const f=await fixture(t),robots=await(await f.request('/robots.txt')).text();
  assert.match(robots,/Sitemap: https:\/\/aniyear.com\/sitemap.xml/);assert.ok(!robots.includes('Disallow: /assets'));assert.ok(!robots.includes('Disallow: /api/\n'));
  for(const url of ['/admin','/account','/login','/register','/watch/test/1','/api/catalog/home','/anime.html','/docs'])assert.match((await f.request(url)).headers.get('x-robots-tag'),/noindex/);
});

test('safe head replacement leaves only one canonical and JSON-LD graph and escapes attribute/script injection',()=>{
  const template='<html><head><title>Old</title><meta content="old" name="description"><link rel="canonical" href="https://old.example"><script type="application/ld+json">{}</script></head><body></body></html>';
  const html=renderSeo(template,config,{title:'Title $&',description:'" onload="bad',path:'/browse?source=popular&page=2',schema:[{'@type':'Thing',name:'</script><script>bad()</script>'}]});
  const $=load(html);assert.equal($('title').text(),'Title $& — Aniyear');assert.equal($('link[rel="canonical"]').length,1);
  assert.equal($('meta[name="description"]').length,1);assert.equal($('[onload]').length,0);
  assert.equal($('script').length,1);assert.doesNotThrow(()=>JSON.parse($('script').text()));
  assert.match(sitemapXml(['/browse?a=1&b=2','/browse?a=1&b=2'],config.origin),/a=1&amp;b=2/);
});

test('custom landing templates retain branding and footer when the original footer paragraph was removed',()=>{
  const html=seoLanding('<html><head><title>Custom brand</title></head><body><main><section class="landing-right"><h1>Custom text</h1></section></main><footer>Custom footer</footer></body></html>',seoLinks([anime]));
  const $=load(html);assert.equal($('h1').text(),'Custom text');assert.equal($('footer').text(),'Custom footer');
  assert.equal($('.landing-right a').text(),anime.title);assert.equal($('title').text(),'Custom brand');
});

test('SEO requests deduplicate, expire, recover after failure, and cap concurrent upstream work',async()=>{
  let now=0,calls=0,broken=false,release;
  const client={async get(){calls++;if(broken)throw new Error('outage');await new Promise(resolve=>{release=resolve;});return{data:[anime],totalPages:3};}};
  const data=createSeoCatalog(client,null,{now:()=>now});
  const first=data.page(),second=data.page();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);release();await Promise.all([first,second]);
  await data.page();assert.equal(calls,1);now=300001;broken=true;await assert.rejects(data.page());
  broken=false;const retry=data.page();await new Promise(resolve=>setImmediate(resolve));release();await retry;assert.equal(calls,3);
  const resolvers=[];const limited=createSeoCatalog({get:()=>new Promise(resolve=>resolvers.push(resolve))});
  const pending=Array.from({length:8},(_v,i)=>limited.page(new URLSearchParams({page:String(i+1)})));
  await assert.rejects(limited.page(new URLSearchParams({page:'9'})),error=>error.status===503);
  await new Promise(resolve=>setImmediate(resolve));resolvers.forEach(resolve=>resolve({data:[anime],totalPages:9}));await Promise.all(pending);
});
