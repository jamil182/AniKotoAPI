import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { extractWatchSuggestions } from './watchSuggestions.js';

test('watch suggestions extract explicit related and recommended sections without relabeling trending', () => {
  const card = (slug, title) => `<a class="item" href="/watch/${slug}/ep-1"><img data-src="https://images.example/a.jpg"><span class="name">${title}</span><span class="relation">Sequel</span></a>`;
  const $ = load(`<section class="w-side-section"><div class="head"><h3 class="title">Related Anime</h3></div>${card('sequel-123','Sequel')}${card('sequel-123','Duplicate')}</section><section class="w-side-section"><h3 class="title">Recommended</h3>${card('other-456','Other')}</section><section class="w-side-section"><h3 class="title">Trending</h3>${card('popular-789','Unrelated')}</section>`);
  assert.deepEqual(extractWatchSuggestions($,'Related').map(row=>row.slug),['sequel-123']);
  assert.equal(extractWatchSuggestions($,'Related')[0].relation,'Sequel');
  assert.deepEqual(extractWatchSuggestions($,'Recommended').map(row=>row.slug),['other-456']);
});

test('related extraction excludes invalid links and unnamed cards and bounds source output', () => {
  const cards = Array.from({length:50},(_,index)=>`<div class="item"><a href="/watch/anime-${index}"><span class="name">Anime ${index}</span></a></div>`).join('');
  const $ = load(`<div id="w-related"><a class="item" href="javascript:bad"><span class="name">Bad</span></a><a class="item" href="/watch/unnamed"></a>${cards}</div>`);
  assert.equal(extractWatchSuggestions($,'Related').length,40);
  assert.deepEqual(extractWatchSuggestions($,'Recommended'),[]);
});

test('absolute HTTPS links from source mirrors retain the slug and actual anime type', () => {
  const $=load('<section class="w-side-section"><h3 class="title">Recommended</h3><a class="item" href="https://anikototv.to/watch/one-piece-special-hamg1"><span class="name">One Piece Special</span><div class="meta"><span class="dot">Special</span><span class="dot">2 Eps</span><span class="dot">Unknown</span></div></a><a class="item" href="https://user:pass@anikoto.cz/watch/private"><span class="name">Bad</span></a></section>');
  const result=extractWatchSuggestions($,'Recommended');
  assert.equal(result.length,1);assert.equal(result[0].slug,'one-piece-special-hamg1');assert.equal(result[0].type,'Special');
});
