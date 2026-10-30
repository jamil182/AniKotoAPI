import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {openDb,migrate} from '../db/db.js';
import {createSynopsisTranslationRouter} from '../routes/synopsisTranslation.route.js';
import {AniKotoError} from './anikotoApi.js';

async function fixture(t,{translate=async()=>({text:'Ini sinopsis terjemahan.',provider:'fixture'}),managed=false}={}) {
  const db=openDb(':memory:');let source='An English synopsis.',calls=0,requests=0,time=100000;
  const client={async get(_endpoint,{id}){requests++;if(id==='missing')throw new AniKotoError('private source diagnostics',404);return{title:'Anime',synopsis:source};}};
  const catalog=managed ? {require(slug){if(slug!=='published')throw new Error('Not published');},description:()=>({title:'Anime',synopsis:source})} : null;
  const app=express();app.use('/translate',createSynopsisTranslationRouter(()=>db,client,catalog,{translate:async(...args)=>{calls++;return translate(...args);},provider:'fixture',now:()=>time}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const get=async(slug='test',query='?lang=id')=>fetch(`http://127.0.0.1:${server.address().port}/translate/${slug}${query}`);
  return {db,get,calls:()=>calls,requests:()=>requests,setSource(value){source=value;},advance(){time+=61000;}};
}
test('synopses use persistent content and provider-keyed caching, deduplication and idempotent migration',async t=>{
  const f=await fixture(t);assert.equal((await f.get()).status,202);
  await new Promise(resolve=>setImmediate(resolve));
  const ready=await f.get();assert.equal(ready.status,200);assert.equal((await ready.json()).results.text,'Ini sinopsis terjemahan.');assert.equal(f.calls(),1);
  assert.equal((await f.get('other-title')).status,200);assert.equal(f.calls(),1);
  migrate(f.db);assert.equal((await f.get()).status,200);
  f.setSource('A changed synopsis.');assert.equal((await f.get()).status,202);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls(),2);
});
test('validation refuses arbitrary text, paths, languages, missing and unpublished titles',async t=>{
  const f=await fixture(t);assert.equal((await f.get('test','?lang=en')).status,400);assert.equal((await f.get('bad!')).status,404);
  assert.equal((await f.get('missing')).status,404);assert.equal(f.calls(),0);
  f.setSource('x'.repeat(6001));assert.equal((await f.get()).status,413);assert.equal(f.calls(),0);
  const managed=await fixture(t,{managed:true});assert.equal((await managed.get('draft')).status,404);assert.equal(managed.requests(),0);
  assert.equal((await managed.get('published')).status,202);
});
test('failed translation returns retryable status without caching fake or partial output',async t=>{
  const f=await fixture(t,{translate:async()=>{throw new Error('private provider secret');}});
  assert.equal((await f.get()).status,202);await new Promise(resolve=>setImmediate(resolve));
  const failure=await f.get();assert.equal(failure.status,503);assert.equal(failure.headers.get('retry-after'),'60');assert.ok(!(await failure.text()).includes('secret'));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM synopsis_translations').get().n,0);
  f.advance();assert.equal((await f.get()).status,202);
});
test('parallel jobs are bounded while repeated requests for one source share the same work',async t=>{
  const resolves=[];const f=await fixture(t,{translate:()=>new Promise(resolve=>resolves.push(resolve))});
  assert.equal((await f.get()).status,202);assert.equal((await f.get()).status,202);assert.equal(f.calls(),1);
  f.setSource('Second synopsis');assert.equal((await f.get()).status,202);
  f.setSource('Third synopsis');assert.equal((await f.get()).status,503);assert.equal(f.calls(),2);
  resolves.forEach(resolve=>resolve({text:'Terjemahan.',provider:'fixture'}));await new Promise(resolve=>setImmediate(resolve));
});
