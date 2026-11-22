import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createDiscoveryRouter} from './discovery.route.js';

async function serve(client,catalog,run) {
  const app=express();app.use('/api/discovery',createDiscoveryRouter(client,catalog));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try {await run(`http://127.0.0.1:${server.address().port}/api/discovery`);} finally {await new Promise(resolve=>server.close(resolve));}
}
test('advanced search validates before contacting the source and forwards combined filters',async()=>{
  const calls=[];
  await serve({discover:async filters=>{calls.push(filters);return{data:[],totalPages:1};}},null,async url=>{
    const good=await fetch(url+'?q=One%20Piece&genre=Adventure&year=1999&format=TV&status=RELEASING');assert.equal(good.status,200);assert.equal(calls[0].genre,'Adventure');assert.equal(calls[0].year,'1999');
    const bad=await fetch(url+'?year=1200');assert.equal(bad.status,400);assert.equal(calls.length,1);
    assert.equal((await fetch(url+'?q[a]=b')).status,400);
  });
});
test('provider failures remain retryable and a managed catalog cannot leak public search results',async()=>{
  await serve({discover:async()=>{throw Error('private detail');}},null,async url=>{const response=await fetch(url);assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'60');assert.ok(!(await response.text()).includes('private detail'));});
  let called=false;await serve({discover:async()=>{called=true;}},{},async url=>assert.equal((await fetch(url)).status,503));assert.equal(called,false);
});
