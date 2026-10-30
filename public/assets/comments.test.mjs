import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { commentMarkup, formatCommentSelection, timestampText } from './comment-markup.js';
import { commentHTML, reactionsHTML, commentShell } from './comments-view.js';
import { commentRequest } from './comments-api.js';
import { isComment, isCommentPage, COMMENT_MOODS } from './comment-data.js';

const item={id:1,animeSlug:'test-anime',episode:2,parentId:null,author:'<img src=x onerror=bad()>',body:'**<script>bad()</script>** _italics_ ~~strike~~ ||secret|| [12:34]\n> quote',spoiler:false,createdAt:0,deleted:false,likes:0,liked:false,canDelete:false,replyCount:0};
test('comment formatting escapes all user HTML while providing safe formatting, spoilers and episode-aware timestamps',()=>{
  const $=cheerio.load(commentHTML(item,{watchEpisode:2,signedIn:false}));
  assert.equal($('script,img,iframe,a').length,0); assert.equal($('strong').text(),'<script>bad()</script>'); assert.equal($('em').text(),'italics'); assert.equal($('s').text(),'strike');
  assert.equal($('[data-reveal]').attr('aria-expanded'),'false'); assert.equal($('[data-reveal] [hidden]').text(),'secret'); assert.equal($('[data-seek]').attr('data-seek'),'754');
  assert.equal($('[data-like]').is('[disabled]'),true); assert.equal($('[data-delete]').length,0);
  assert.equal(cheerio.load(commentHTML(item,{watchEpisode:1}))('[data-seek]').length,0);
  assert.equal(cheerio.load(commentMarkup('[1:99]'))('[data-seek]').length,0);
  assert.equal(timestampText(65.2),'01:05');
});
test('format toolbar preserves selection without injecting HTML or inventing content',()=>{
  assert.deepEqual(formatCommentSelection('hello world',6,11,'bold'),{text:'hello **world**',start:8,end:13});
  assert.deepEqual(formatCommentSelection('hello',0,0,'spoiler'),{text:'||||hello',start:2,end:2});
  assert.equal(formatCommentSelection('a\nb',0,3,'quote').text,'> a\n> b');
});
test('reactions show real nonnegative totals and the anonymous editor starts locked',()=>{
  const $=cheerio.load(reactionsHTML({peak:12,mid:-1},'peak',true));
  assert.equal($('[aria-pressed=true]').attr('data-mood'),'peak'); assert.equal($('[data-mood=peak]').text(),'🔥Peak12'); assert.equal($('[data-mood=mid]').text(),'😐Mid0');
  const shell=cheerio.load(commentShell()); assert.equal(shell('textarea[disabled]').length,1); assert.equal(shell('form button[type=submit][disabled]').length,1);
});
test('comment payload guards reject malformed and deeply nested data instead of rendering it',()=>{
  const valid={...item,author:'User',body:'Fine',replies:[]};
  assert.equal(isComment(valid,true),true);
  const page={comments:[valid],total:1,page:1,pages:1,reactions:Object.fromEntries(COMMENT_MOODS.map(mood=>[mood.key,0])),myReaction:null};
  assert.equal(isCommentPage(page),true);
  for(const changed of [{likes:-1},{body:'x'.repeat(4001)},{id:'1 onclick=bad'},{replies:[{...valid,replies:[valid]}]}]) assert.equal(isComment({...valid,...changed},true),false);
  assert.equal(isCommentPage({...page,myReaction:'made-up'}),false);
});
test('comment writes send same-origin cookies and report auth failures without exposing malformed responses',async t=>{
  let sent;
  t.mock.method(globalThis,'fetch',async(url,options)=>{sent={url,...options};return Response.json({success:false,message:'Silakan login.'},{status:401});});
  await assert.rejects(commentRequest('',{method:'POST',body:{body:'hello'}}),error=>error.status===401);
  assert.equal(sent.credentials,'same-origin'); assert.equal(sent.cache,'no-store'); assert.equal(sent.headers['Content-Type'],'application/json');
  globalThis.fetch.mock.mockImplementation(async()=>new Response('broken',{status:502}));
  await assert.rejects(commentRequest('?slug=test'),/belum dapat dimuat/);
});
