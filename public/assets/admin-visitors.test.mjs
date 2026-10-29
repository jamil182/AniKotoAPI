import test from 'node:test';
import assert from 'node:assert/strict';
import { renderVisitorStats } from './admin-visitors.js';

function fakePage() {
  const node = () => ({ children: [], textContent: '', className: '', disabled: false,
    append(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    get firstElementChild() { return this.children[0]; },
  });
  const nodes = new Map();
  return { createElement: node, getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } };
}
const stats = { startedAt: Date.UTC(2026, 9, 30), generatedAt: Date.UTC(2026, 9, 30, 1), onlineWindowSeconds: 90,
  totals: { visits: 5, pageviews: 12 }, today: { visitors: 2, visits: 3, pageviews: 7 }, online: 1,
  page: 1, pages: 2, total: 21, visitors: [], daily: [{ day: '2026-10-30', visitors: 2, visits: 3, pageviews: 7 }] };

test('admin renders empty states, counters and real pagination without interpolating HTML', () => {
  const page = fakePage();
  renderVisitorStats(page, stats);
  assert.equal(page.getElementById('visitorsOnline').textContent, '1');
  assert.equal(page.getElementById('visitorsViews').textContent, '12');
  assert.equal(page.getElementById('visitorsPrev').disabled, true);
  assert.equal(page.getElementById('visitorsNext').disabled, false);
  assert.equal(page.getElementById('visitorsRows').children[0].children[0].colSpan, 6);
  const unsafe = '<img src=x onerror=alert(1)>';
  renderVisitorStats(page, { ...stats, page: 2, visitors: [{ ip: '8.8.8.8', city: unsafe, region: '', country: '',
    status: 'resolved', path: unsafe, firstSeen: stats.startedAt, lastSeen: stats.generatedAt, views: 2, online: true }] });
  const cells = page.getElementById('visitorsRows').children[0].children;
  assert.equal(cells[2].textContent, unsafe);
  assert.equal(cells[3].textContent, unsafe);
  assert.equal(cells[2].children.length, 0);
  assert.equal(page.getElementById('visitorsRows').children.length, 1);
  assert.equal(page.getElementById('visitorsNext').disabled, true);
});
