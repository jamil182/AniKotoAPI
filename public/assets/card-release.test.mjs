import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseCardHTML } from './card-release.js';

test('shows the feed episode number and elapsed time while rejecting unsafe or future values', () => {
  const time = Date.parse('2026-11-22T14:00:00Z');
  assert.match(releaseCardHTML({ latestEpisode: 8, releasedAt: '2026-11-22T12:00:00Z' }, time), /EP 8.*2h ago/);
  for (const row of [{ latestEpisode: '<img>', releasedAt: '2026-11-22' }, { latestEpisode: 1, releasedAt: 'invalid' }, { latestEpisode: 1, releasedAt: '2027-01-01' }]) assert.equal(releaseCardHTML(row, time), '');
});
