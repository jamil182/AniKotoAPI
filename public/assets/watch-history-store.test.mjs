import test from 'node:test';
import assert from 'node:assert/strict';
import { createWatchHistoryStore, historyEntry, historyImage, historyCompleted, HISTORY_KEY } from './watch-history-store.js';

const storage = () => { const values = new Map(); return { getItem:key=>values.get(key)||null, setItem:(key,value)=>values.set(key,value) }; };
const entry = (slug='al-21',updated=1000) => ({slug,title:'One Piece',episode:1,poster:'https://cdn.example.com/poster.jpg',time:120,duration:1440,updated});
test('history rejects corrupt entries and unsafe media while retaining valid legacy browser records', () => {
  assert.equal(historyEntry(null),null); assert.equal(historyEntry({...entry(),time:NaN}),null); assert.equal(historyEntry({...entry(),slug:'../secrets'}),null);
  assert.equal(historyEntry({...entry(),time:2000}),null); assert.equal(historyEntry({...entry(),duration:Infinity}),null);
  assert.equal(historyImage('javascript:alert(1)'),'/favicon.svg'); assert.equal(historyImage('data:image/svg+xml;base64,AA==',true),'/favicon.svg');
  assert.equal(historyImage('data:image/jpeg;base64,AA==',true),'data:image/jpeg;base64,AA=='); assert.equal(historyImage('https://user:pass@example.com/a.jpg'),'/favicon.svg');
  assert.equal(historyEntry(entry()).episode,1);
});
test('saving progress replaces the same title, keeps real last-watched order and bounds storage', () => {
  const store = createWatchHistoryStore(storage());
  assert.ok(store.save(entry())); assert.ok(store.save({...entry('al-21',2000),episode:2,time:45})); assert.equal(store.list().length,1); assert.equal(store.list()[0].episode,2);
  for(let id=1;id<=70;id++) store.save(entry('show-'+id,id*3000));
  assert.equal(store.list().length,50); assert.equal(store.list()[0].slug,'show-70');
  assert.equal(historyCompleted({...entry(),time:1430}),true); assert.equal(historyCompleted(entry()),false);
});
test('paused history refuses new playback writes and survives a new store instance', () => {
  const data = storage(), store = createWatchHistoryStore(data); store.save(entry()); store.setPaused(true);
  assert.equal(store.save(entry('different')),false); assert.equal(store.list().length,1); assert.equal(createWatchHistoryStore(data).paused(),true);
  store.setPaused(false); assert.ok(store.save(entry('different')));
});
test('clearing can be undone across page reloads without overwriting newer viewing progress', () => {
  const data = storage(), store = createWatchHistoryStore(data,()=>1000); store.save(entry()); assert.ok(store.clear()); assert.equal(store.list().length,0); assert.equal(store.canUndo(),true);
  const reloaded = createWatchHistoryStore(data,()=>2000); reloaded.save({...entry(),episode:3,updated:2000}); assert.ok(reloaded.undo()); assert.equal(reloaded.list()[0].episode,3); assert.equal(reloaded.canUndo(),false);
  reloaded.clear(); assert.equal(createWatchHistoryStore(data,()=>90000000).undo(),false);
});
test('corrupt or unavailable browser storage never crashes playback', () => {
  const data = storage(); data.setItem(HISTORY_KEY,'not json'); assert.deepEqual(createWatchHistoryStore(data).list(),[]);
  const blocked = createWatchHistoryStore({getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}});
  assert.deepEqual(blocked.list(),[]); assert.equal(blocked.save(entry()),false); assert.equal(blocked.clear(),false);
});
