import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navigationItems } from './site-menu.js';
import { catalogParams } from './catalog-pagination.js';
import { CATALOG_VIEWS, ANIME_TYPES } from './catalog-sources.js';

test('site navigation uses local working destinations and category URLs survive pagination parsing', () => {
  assert.deepEqual(navigationItems.map(item => item.label), ['HOME', 'WEEKLY SCHEDULE', 'GENRE', 'UPDATED', 'ADDED', 'POPULAR', 'UPCOMING', 'ONGOING', 'COMPLETED']);
  for (const item of navigationItems) {
    const url = new URL(item.href, 'https://anijs.invalid');
    assert.equal(url.origin, 'https://anijs.invalid');
    if (url.pathname === '/browse') assert.equal(catalogParams(url.search).source, url.searchParams.get('source'));
  }
  for (const source of Object.keys(CATALOG_VIEWS)) assert.equal(catalogParams(`?source=${source}&page=2`).source, source);
  for (const type of Object.keys(ANIME_TYPES)) assert.equal(catalogParams(`?type=${type}&page=2`).type, type);
  assert.equal(catalogParams('?type=../admin').type, undefined);
});
