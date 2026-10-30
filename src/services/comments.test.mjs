import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import express from 'express';
import { openDb, migrate } from '../db/db.js';
import { createCommentsRouter, createCommentsModerationRouter } from '../routes/comments.route.js';
import { AniKotoError } from './anikotoApi.js';

const slug = 'test-anime-ab123';
async function fixture(t, { managed = false, maxWrites = 120 } = {}) {
  const db = openDb(':memory:'), app = express(); let time = Date.UTC(2026, 9, 30), available = true, failure = false, calls = 0;
  const users = [1, 2].map(id => {
    db.prepare('INSERT INTO user_accounts(id,email,display_name,password_hash,created_at) VALUES (?,?,?,?,?)').run(id, `user${id}@example.com`, 'User ' + id, '!fixture', time);
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO user_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), id, time, time + 7 * 86400000);
    return 'anijs_session=' + token;
  });
  const client = { async get(path, params) {
    calls++; if (failure) throw new AniKotoError('private upstream diagnostic', 502);
    if (path === '/info') return { slug: params.id === slug ? slug : 'other-anime', title: 'Test Anime' };
    return { episodes: [{ episode_no: 1 }, { episode_no: 2 }, { episode_no: 12.5 }] };
  } };
  const catalog = managed ? { require(value) { if (!available || value !== slug) throw new AniKotoError('Not published', 404); }, episodes() { return { episodes: [{ episode_no: 1 }] }; } } : null;
  const oldAdmin = process.env.ADMIN_TOKEN; process.env.ADMIN_TOKEN = 'comments-test-admin';
  app.use(express.json({ limit: '32kb' }));
  app.use('/api/comments', createCommentsRouter(() => db, client, catalog, { now: () => time, maxWrites }));
  app.use('/api/admin/comments', createCommentsModerationRouter(() => db, { now: () => time }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); if (oldAdmin === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = oldAdmin; });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path = '', { method = 'GET', body, cookie, headers = {}, admin = false } = {}) => fetch(base + '/api/' + (admin ? 'admin/comments' : 'comments') + path, {
    method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  });
  const draft = (extra = {}) => ({ slug, episode: 1, body: 'A thoughtful comment', spoiler: false, parentId: null, requestId: randomUUID(), ...extra });
  const create = async (extra = {}, cookie = users[0]) => {
    const response = await request('', { method: 'POST', cookie, body: draft(extra) });
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json())); return (await response.json()).results;
  };
  const list = async (query = {}, cookie) => (await (await request('?' + new URLSearchParams({ slug, episode: '1', ...query }), { cookie })).json()).results;
  return { db, users, request, draft, create, list, advance: (ms = 15000) => { time += ms; }, unpublish() { available = false; }, upstreamFails() { failure = true; }, calls: () => calls };
}

test('public discussion is readable while all writes require a real unexpired local session', async t => {
  const f = await fixture(t);
  const empty = await f.list(); assert.equal(empty.total, 0); assert.ok(Object.values(empty.reactions).every(value => value === 0));
  for (const [method, path, body] of [['POST','',f.draft()],['PUT','/reaction',{ slug, mood:'peak' }],['PUT','/1/like',{ liked:true }],['DELETE','/1',{}]]) {
    assert.equal((await f.request(path, { method, body })).status, 401);
    assert.equal((await f.request(path, { method, body, cookie:'anijs_session=invalid' })).status, 401);
  }
  assert.equal(f.calls(), 0);
  const item = await f.create({ body:'<script>bad()</script> **great**' });
  const guest = await f.list(); assert.equal(guest.total, 1); assert.equal(guest.comments[0].body, item.body);
  assert.equal(guest.comments[0].canDelete, false); assert.equal(guest.comments[0].liked, false);
  assert.ok(!JSON.stringify(guest).includes('@example.com')); assert.ok(!JSON.stringify(guest).includes('user_id'));
  assert.equal((await f.list({}, f.users[0])).comments[0].canDelete, true);
  f.advance(7*86400000);
  assert.equal((await f.request('', { method:'POST', cookie:f.users[0], body:f.draft() })).status, 401);
});

test('comment validation rejects forged identities, bad resources, nested replies, cross-site and invalid JSON content types', async t => {
  const f = await fixture(t), cookie = f.users[0];
  for (const change of [{ userId:2 }, { body:' ' }, { body:'\u200b\u200c' }, { body:'x'.repeat(4001) }, { body:'bad\u0000text' }, { slug:'../../private' }, { episode:-1 }, { episode:Infinity }, { requestId:'not-uuid' }, { spoiler:'true' }]) assert.equal((await f.request('', { method:'POST', cookie, body:f.draft(change) })).status, 400);
  assert.equal((await f.request('', { method:'POST', cookie, body:f.draft(), headers:{ Origin:'https://attacker.example' } })).status, 403);
  assert.equal((await f.request('', { method:'POST', cookie, body:f.draft(), headers:{ 'Sec-Fetch-Site':'cross-site' } })).status, 403);
  assert.equal((await f.request('', { method:'POST', cookie, body:f.draft(), headers:{ 'Content-Type':'text/plain' } })).status, 415);
  assert.equal((await f.request('', { method:'POST', cookie, body:f.draft({ episode:999 }) })).status, 404);
  assert.equal((await f.request('', { method:'POST', cookie, body:f.draft({ slug:'fake-anime' }) })).status, 404);
  for (const query of [{sort:'id;DROP TABLE anime_comments'},{page:'0'},{page:'1000001'},{episode:'bad'}]) assert.equal((await f.request('?' + new URLSearchParams({slug, ...query}))).status, 400);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM anime_comments').get().n, 0);
});

test('idempotent submission, persistent per-user spam limits, international text and episode separation survive migration', async t => {
  const f = await fixture(t), payload = f.draft({ body:'水'.repeat(4000) }), cookie=f.users[0];
  const first = await f.request('', {method:'POST',cookie,body:payload}); assert.equal(first.status,201);
  const id = (await first.json()).results.id;
  assert.equal((await (await f.request('',{method:'POST',cookie,body:payload})).json()).results.id,id);
  assert.equal((await f.request('',{method:'POST',cookie,body:{...payload,body:'changed'}})).status,409);
  const limited = await f.request('',{method:'POST',cookie,body:f.draft()}); assert.equal(limited.status,429); assert.equal(limited.headers.get('retry-after'),'10');
  f.advance(); await f.create({ episode:12.5 }); f.advance(); await f.create({ episode:0 });
  assert.equal((await f.list({episode:'all'})).total,3); assert.equal((await f.list({episode:'0'})).total,1); assert.equal((await f.list({episode:'12.5'})).total,1);
  migrate(f.db); assert.equal((await f.list()).comments[0].id,id);
});

test('likes and anime moods are idempotent, unique per user and sort popular comments using real counts', async t => {
  const f=await fixture(t), old=await f.create(); f.advance(); const recent=await f.create({body:'A later comment'});
  const like=(user,liked)=>f.request('/'+old.id+'/like',{method:'PUT',cookie:user,body:{liked}});
  await like(f.users[0],true); await like(f.users[0],true); await like(f.users[1],true);
  assert.equal((await f.list({sort:'popular'},f.users[0])).comments[0].likes,2);
  assert.equal((await f.list({sort:'newest'})).comments[0].id,recent.id); assert.equal((await f.list({sort:'oldest'})).comments[0].id,old.id);
  await like(f.users[0],false); assert.equal((await f.list({},f.users[0])).comments.find(row=>row.id===old.id).liked,false);
  const react=(cookie,mood)=>f.request('/reaction',{method:'PUT',cookie,body:{slug,mood}});
  await react(f.users[0],'peak'); await react(f.users[0],'peak'); await react(f.users[1],'peak');
  assert.equal((await f.list()).reactions.peak,2);
  await react(f.users[0],'funny'); assert.equal((await f.list({},f.users[0])).myReaction,'funny');
  await react(f.users[0],null); const guest=await f.list(); assert.equal(guest.reactions.peak,1); assert.equal(guest.reactions.funny,0); assert.equal(guest.myReaction,null);
});

test('replies stay within one anime and episode, are bounded, paginate, and preserve context when a root is deleted', async t => {
  const f=await fixture(t), root=await f.create();
  assert.equal((await f.request('',{method:'POST',cookie:f.users[1],body:f.draft({parentId:root.id,episode:2})})).status,400);
  let child;
  for(let index=0;index<22;index++){f.advance(); child=await f.create({parentId:root.id,body:'Reply '+index},f.users[1]);}
  const data=await f.list(); assert.equal(data.total,23); assert.equal(data.comments[0].replyCount,22); assert.equal(data.comments[0].replies.length,3);
  const replies=await (await f.request('/'+root.id+'/replies?page=999')).json(); assert.equal(replies.results.page,2); assert.equal(replies.results.comments.length,2);
  f.advance(); assert.equal((await f.request('',{method:'POST',cookie:f.users[0],body:f.draft({parentId:child.id})})).status,400);
  assert.equal((await f.request('/'+root.id,{method:'DELETE',cookie:f.users[1],body:{}})).status,404);
  assert.equal((await f.request('/'+root.id,{method:'DELETE',cookie:f.users[0],body:{}})).status,200);
  const deleted=await f.list(); assert.equal(deleted.total,22); assert.equal(deleted.comments[0].deleted,true); assert.equal(deleted.comments[0].body,''); assert.equal(deleted.comments[0].author,'Komentar dihapus');
  assert.equal((await f.request('/'+root.id+'/like',{method:'PUT',cookie:f.users[1],body:{liked:true}})).status,404);
});

test('moderation requires ADMIN_TOKEN, masks hidden content publicly and never restores an author-deleted comment', async t => {
  const f=await fixture(t), item=await f.create();
  assert.equal((await f.request('',{admin:true,cookie:f.users[0]})).status,401);
  const auth={ 'X-Admin-Token':'comments-test-admin' };
  assert.equal((await f.request('/'+item.id,{admin:true,method:'PATCH',headers:auth,body:{hidden:true}})).status,200);
  assert.equal((await f.list()).total,0); assert.equal((await f.list()).comments.length,0);
  const hidden=await (await f.request('?state=hidden',{admin:true,headers:auth})).json(); assert.equal(hidden.results.comments[0].body,item.body);
  assert.equal((await f.request('/'+item.id,{admin:true,method:'PATCH',headers:auth,body:{hidden:false}})).status,200);
  assert.equal((await f.list()).total,1);
  await f.request('/'+item.id,{method:'DELETE',cookie:f.users[0],body:{}});
  assert.equal((await f.request('/'+item.id,{admin:true,method:'PATCH',headers:auth,body:{hidden:false}})).status,409);
});

test('managed visibility gates all public reads and interactions while cached discussions survive live source outages', async t => {
  const f=await fixture(t,{managed:true}), item=await f.create(); f.unpublish();
  assert.equal((await f.request('?slug='+slug+'&episode=1')).status,404);
  assert.equal((await f.request('/'+item.id+'/replies')).status,404);
  assert.equal((await f.request('/'+item.id+'/like',{method:'PUT',cookie:f.users[0],body:{liked:true}})).status,404);
  const live=await fixture(t), existing=await live.create(); live.upstreamFails();
  assert.equal((await live.list()).comments[0].id,existing.id); live.advance();
  const failed=await live.request('',{method:'POST',cookie:live.users[0],body:live.draft()}); assert.equal(failed.status,502); assert.ok(!JSON.stringify(await failed.json()).includes('private upstream'));
});

test('root pagination is bounded and per-account limits cannot be bypassed by deleting or recreating a repository', async t=>{
  const f=await fixture(t);
  for(let index=0;index<30;index++){if(index)f.advance(100000);await f.create({body:'Root '+index});}
  const first=await f.list();assert.equal(first.comments.length,20);assert.equal(first.pages,2);
  const last=await f.list({page:'999'});assert.equal(last.page,2);assert.equal(last.comments.length,10);
  f.advance(100000);
  const blocked=await f.request('',{method:'POST',cookie:f.users[0],body:f.draft()});assert.equal(blocked.status,429);
  assert.equal(Number(blocked.headers.get('retry-after')),600);
  await f.request('/'+first.comments[0].id,{method:'DELETE',cookie:f.users[0],body:{}});
  migrate(f.db);
  assert.equal((await f.request('',{method:'POST',cookie:f.users[0],body:f.draft()})).status,429);
});

test('write budgets are bounded per verified visitor and invalid moods or like payloads cannot change counts', async t=>{
  const f=await fixture(t,{maxWrites:1});await f.create();
  assert.equal((await f.request('/reaction',{method:'PUT',cookie:f.users[1],body:{slug,mood:'peak'}})).status,429);
  f.advance(60001);
  assert.equal((await f.request('/reaction',{method:'PUT',cookie:f.users[1],body:{slug,mood:'not-real'}})).status,400);
  assert.ok(Object.values((await f.list()).reactions).every(value=>value===0));
});
