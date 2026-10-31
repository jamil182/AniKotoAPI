import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchSuggestionGroups } from './watch-suggestions.js';

test('suggestions keep series relations separate from recommendations and exclude the playing anime', () => {
  const rows = [{slug:'current',title:'Playing'},{slug:'sequel/ep-1',title:'Sequel',poster:'https://images.example/a.jpg'},{slug:'sequel',title:'Duplicate'}];
  const result = watchSuggestionGroups({related:rows,recommended:[{slug:'other',title:'Other'}],trending:[{slug:'trending',title:'Trending'}]},'current');
  assert.deepEqual(result.related.map(row=>row.slug),['sequel']);
  assert.deepEqual(result.recommended.map(row=>row.slug),['other']);
  assert.deepEqual(watchSuggestionGroups(null,'current'),{related:[],recommended:[]});
});

test('suggestions validate slugs and image URLs while preserving titles as plain text', () => {
  const result = watchSuggestionGroups({recommended:[{slug:'javascript:alert(1)',title:'Bad'},null,{slug:'empty',title:' '},{slug:'safe',title:'<img onerror="bad()">',poster:'javascript:alert(1)'},{slug:'credentials',title:'Private',poster:'https://user:pass@images.example/a.jpg'}]},'current');
  assert.equal(result.recommended.length,2);
  assert.equal(result.recommended[0].title,'<img onerror="bad()">');
  assert.ok(result.recommended.every(row=>row.poster==='/favicon.svg'));
  assert.equal(watchSuggestionGroups({related:Array.from({length:50},(_,index)=>({slug:'anime-'+index,title:'Anime'}))},'current').related.length,40);
});
