import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageNumbers, catalogParams, paginationHTML } from './catalog-pagination.js';

test('pagination covers first, middle, last and small page ranges without unbounded loops', () => {
  assert.deepEqual(pageNumbers(1, 1), [1]);
  assert.deepEqual(pageNumbers(1, 301), [1, 2, 3, 4, '…', 301]);
  assert.deepEqual(pageNumbers(150, 301), [1, '…', 149, 150, 151, '…', 301]);
  assert.deepEqual(pageNumbers(301, 301), [1, '…', 300, 301]);
  assert.deepEqual(pageNumbers(999, 3), [1, 2, 3]);
  assert.deepEqual(pageNumbers(Infinity, Infinity), [1]);
  assert.deepEqual(pageNumbers(-1, -5), [1]);
});

test('URL page and filters are normalized safely and conflicting filters use genre', () => {
  assert.deepEqual(catalogParams('?page=2&source=latest'), { source: 'latest', page: 2 });
  assert.deepEqual(catalogParams('?page=-1&source=unknown&genre=../private&letter=AB'), { source: 'latest', page: 1 });
  assert.deepEqual(catalogParams('?source=trending&page=7&letter=A'), { source: 'trending', page: 7, letter: 'a' });
  assert.deepEqual(catalogParams('?genre=action&letter=B'), { source: 'latest', page: 1, genre: 'action' });
  assert.equal(catalogParams('?page=10000').page, 1);
});

test('pagination exposes current page and disables unavailable or busy navigation', () => {
  const first = paginationHTML(1, 301);
  assert.match(first, /aria-label="Previous page"[^>]*disabled/);
  assert.match(first, /aria-label="Page 1" aria-current="page"/);
  assert.match(first, /Page 1 of 301/);
  assert.match(paginationHTML(301, 301), /aria-label="Next page"[^>]*disabled/);
  assert.equal((paginationHTML(2, 3, true).match(/<button/g) || []).length, (paginationHTML(2, 3, true).match(/ disabled/g) || []).length);
});
