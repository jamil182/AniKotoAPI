import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { episodeNumber, navigationEpisodes, episodeRanges } from './episode-navigation.js';

test('episode ranges include the final partial batch without inventing missing numbers', () => {
  const episodes = Array.from({length:1180},(_,index)=>({episode_no:index+1}));
  const ranges = episodeRanges(episodes);
  assert.equal(ranges.length,12);
  assert.deepEqual(ranges[0],{start:0,end:100,label:'1-100'});
  assert.deepEqual(ranges.at(-1),{start:1100,end:1180,label:'1101-1180'});
  assert.equal(episodes.slice(ranges.at(-1).start,ranges.at(-1).end).length,80);
  assert.deepEqual(episodeRanges([]),[]);
  assert.equal(episodeRanges(episodes.slice(0,100)).length,1);
  assert.deepEqual(episodeRanges(episodes.slice(0,101)).at(-1),{start:100,end:101,label:'101-101'});
});

test('navigation preserves real fractional and sparse episodes, sorts numbers and removes equivalent duplicates', () => {
  const rows=navigationEpisodes([{episode_no:'12.5',title:'Special'},{episode_no:2},{episode_no:'1'},{episode_no:'2.0'},{episode_no:400},{episode_no:'bad'},{episode_no:-1},{episode_no:Infinity}]);
  assert.deepEqual(rows.map(row=>row.episode_no),['1',2,'12.5',400]);
  assert.equal(episodeRanges(rows)[0].label,'1-400');
  assert.equal(rows[2].title,'Special');
  for(const value of ['',null,undefined,{},'1e2','<img>','1.1234',100001,'1 onclick=bad'])assert.equal(episodeNumber(value),null);
  for(const [value,expected] of [['12.5',12.5],[0,0],['100000',100000]])assert.equal(episodeNumber(value),expected);
});

test('watch page provides labeled controls and bounded navigation separately from the description', async () => {
  const html=await readFile(new URL('../watch.html',import.meta.url),'utf8'),$=cheerio.load(html);
  assert.equal($('.ep-col [data-episode-range][aria-label]').length,1);
  assert.equal($('.ep-col [data-episode-find][aria-describedby=episodeFindStatus]').length,1);
  assert.equal($('.ep-col nav[data-episode-grid]').length,1);
  assert.equal($('.ep-col #infoPanel').length,0);
  assert.equal($('.watch-player-column #playerWrap').length,1);
  assert.equal($('.watch2 > #infoPanel.watch-description').length,1);
});
