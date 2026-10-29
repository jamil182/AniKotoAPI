import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillCatalogRow } from './catalog-row-fill.js';

const items = Array.from({ length: 40 }, (_, id) => ({ id: `anime-${id}` }));
test('six-column Latest Episodes gains two distinct next-page posters', () => {
  const next = [items[0], { id: 'anime-40' }, { id: 'anime-40' }, { id: 'anime-41' }];
  const result = fillCatalogRow(items, next, 6);
  assert.equal(result.length, 42);
  assert.equal(new Set(result.map(item => item.id)).size, 42);
  assert.deepEqual(result.slice(-2).map(item => item.id), ['anime-40', 'anime-41']);
  assert.equal(items.length, 40);
});

test('responsive grids that are already complete do not add unnecessary cards', () => {
  for (const columns of [2, 4, 5]) assert.deepEqual(fillCatalogRow(items, [{ id: 'extra' }], columns), items);
  assert.equal(fillCatalogRow(items, [{ id: 'a' }, { id: 'b' }], 3).length, 42);
});

test('missing candidates, empty pages and invalid columns do not fabricate posters', () => {
  assert.equal(fillCatalogRow(items, items, 6).length, 40);
  assert.equal(fillCatalogRow(items, [], 6).length, 40);
  assert.deepEqual(fillCatalogRow([], [{ id: 'extra' }], 6), []);
  assert.equal(fillCatalogRow(items, [{ id: 'extra' }], Infinity).length, 40);
});
