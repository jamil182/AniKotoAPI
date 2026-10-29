import { test } from 'node:test';
import assert from 'node:assert/strict';
import { episodeProgress, cardProgressHTML } from './card-progress.js';

test('episode badges show released episodes and the real total', () => {
  assert.deepEqual(episodeProgress({ sub: '4', dub: 0, total: 23 }), { sub: 4, dub: 0, total: 23 });
  const html = cardProgressHTML({ sub: 4, total: 23, type: 'TV' });
  assert.match(html, /SUB: 4 released \/ 23 total episodes/);
  assert.match(html, /class="episode-total">\/ 23/);
  assert.match(html, /class="card-format">TV/);
  assert.ok(html.includes('CC'));
});

test('unknown, inconsistent and invalid totals are not invented', () => {
  assert.equal(episodeProgress({ sub: 4, total: 0 }).total, null);
  assert.equal(episodeProgress({ sub: 13, total: 12 }).total, null);
  assert.equal(episodeProgress({ sub: 4, total: 0, totalEpisodes: '24' }).total, 24);
  assert.deepEqual(episodeProgress({ sub: -1, dub: true, total: 'NaN' }), { sub: null, dub: null, total: null });
  assert.match(cardProgressHTML({ sub: 4, total: 0 }), /SUB: 4 released \/ \? total episodes/);
});

test('SUB and DUB counts remain separate and upcoming episodes show zero', () => {
  const html = cardProgressHTML({ sub: 12, dub: 8, total: 24 });
  assert.match(html, /SUB: 12 released \/ 24/);
  assert.match(html, /DUB: 8 released \/ 24/);
  assert.match(cardProgressHTML({ sub: 0, dub: 0, total: 12 }), /SUB: 0 released \/ 12/);
});

test('card metadata ignores unsafe values and does not present duration as anime type', () => {
  for (const type of ['<img onerror=alert(1)>', '24 min', '__proto__', 'constructor']) {
    const html = cardProgressHTML({ sub: '<script>', total: '23<script>', type });
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('card-format'));
  }
});
