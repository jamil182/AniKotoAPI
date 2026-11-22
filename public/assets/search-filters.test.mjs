import test from 'node:test';
import assert from 'node:assert/strict';
import { searchFilters } from './search-filters.js';
test('search accepts combined anime filters and keeps the query and page on navigation',()=>{
  const input={kind:'anime',q:'One Piece',genre:'Adventure',format:'TV',status:'RELEASING',year:'1999',sort:'SCORE_DESC',page:'2'};
  assert.deepEqual(searchFilters(input,{strict:true}),input);
  assert.deepEqual(searchFilters(Object.fromEntries(new URLSearchParams(input))),input);
});
test('strict search validation rejects objects, control characters, unknown enums and invalid ranges',()=>{
  for(const input of [{q:['a','b']},{q:'x\ny'},{kind:'unknown'},{format:'TV) { id }'},{genre:'unknown'},{year:'1899'},{year:'2101'},{page:'0'},{page:'1000'},{sort:'id desc'},{q:'x'.repeat(121)}]) assert.throws(()=>searchFilters(input,{strict:true}),/Invalid/);
  assert.deepEqual(searchFilters({page:'bad',format:'bad'}),{kind:'anime',page:'1',sort:'POPULARITY_DESC'});
});
test('people searches discard anime-only filters and studio browsing does not silently combine unsupported filters',()=>{
  assert.deepEqual(searchFilters({kind:'staff',q:'Hayao',genre:'Action',year:'2000'}),{kind:'staff',q:'Hayao',page:'1',sort:'POPULARITY_DESC'});
  assert.deepEqual(searchFilters({studio:'MAPPA',q:'Naruto',genre:'Action'}),{kind:'anime',studio:'MAPPA',page:'1',sort:'POPULARITY_DESC'});
});
