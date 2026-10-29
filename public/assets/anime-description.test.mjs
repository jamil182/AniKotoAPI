import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animeDescriptionHTML, animeScore } from './anime-description.js';

test('rating normalization handles repeated upstream scores and invalid values', () => {
  assert.equal(animeScore('8.48   8.48 /10'), 8.48);
  assert.equal(animeScore(10), 10);
  assert.equal(animeScore(0), 0);
  for (const value of [undefined, null, '?', 'N/A', '-1', '11', '10.1', '2023', 'Infinity']) assert.equal(animeScore(value), null);
});

test('description safely escapes metadata and rejects unsafe links and posters', () => {
  const html = animeDescriptionHTML({
    title: '<script>alert(1)</script>', poster: 'javascript:alert(1)',
    synopsis: '<img src=x onerror=alert(1)>', genres: ['<b>Drama</b>'], rating: '8.48',
  }, { heading: 'script', detailHref: 'javascript:alert(1)' });
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('src="/favicon.svg"'));
  assert.ok(html.includes('<h2'));
});

test('missing ratings do not invent scores or review counts', () => {
  const html = animeDescriptionHTML({ title: 'Anime', rating: '?', reviewCount: 'invalid' });
  assert.ok(html.includes('N/A'));
  assert.ok(html.includes('width:0%'));
  assert.ok(html.includes('Catalog score'));
  assert.ok(!html.includes('invalid reviews'));
});

test('metadata uses editorial score, real episode counts and complete source facts', () => {
  const html = animeDescriptionHTML({
    title: 'Scavengers Reign', rating: '8.48', malScore: '8.50', total: 12, episodes: 100,
    premiered: 'FALL 2023', aired: '2023-10-19', studios: ['Titmouse', 'Max'], producers: ['Charles Huettner'],
    altNames: 'Planeta dos Abutres', reviewCount: '49,755',
  });
  assert.ok(html.includes('8.48 <span>/10</span>'));
  assert.ok(html.includes('<dt>MAL:</dt><dd>8.50</dd>'));
  assert.ok(html.includes('<dt>Episodes:</dt><dd>12</dd>'));
  assert.ok(html.includes('49,755 reviews'));
  assert.ok(html.includes('FALL 2023'));
  assert.ok(html.includes('Charles Huettner'));
});
