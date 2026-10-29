import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisitorTracker } from './visitors.js';

test('tracker retries the same page ID without counting heartbeats as new pageviews', async () => {
  const events = [];
  let count = 0;
  const pulse = createVisitorTracker({ path: '/home', eventId: 'stable-id', send: async event => {
    events.push(event);
    if (++count === 1) throw new Error('Timeout after recording');
    return {};
  } });
  await pulse(); await pulse(); await pulse();
  assert.deepEqual(events.map(event => event.type), ['view', 'view', 'heartbeat']);
  assert.ok(events.every(event => event.eventId === 'stable-id'));
});

test('tracker serializes requests and recovers when the server no longer knows the page event', async () => {
  let release;
  const events = [];
  const wait = new Promise(resolve => { release = resolve; });
  const pulse = createVisitorTracker({ path: '/home', eventId: 'stable-id', send: async event => {
    events.push(event); await wait;
    return { needsView: events.length === 2 };
  } });
  const first = pulse(); await pulse();
  assert.equal(events.length, 1);
  release(); await first; await pulse(); await pulse();
  assert.deepEqual(events.map(event => event.type), ['view', 'heartbeat', 'view']);
});
