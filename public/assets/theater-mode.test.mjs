import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountTheaterMode } from './theater-mode.js';
import { languageLabel } from './site-language-data.js';

function fixture(storage) {
  const document = new EventTarget();
  document.fullscreenElement = null;
  const label = { textContent: '' }, attributes = new Map(), classes = new Set();
  const root = { ownerDocument: document, querySelector: () => null, classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } } };
  const button = Object.assign(new EventTarget(), {
    classList: { toggle() {} }, querySelector: () => label,
    setAttribute(name, value) { attributes.set(name, value); },
  });
  const control = mountTheaterMode(root, button, { storage });
  return { root, button, document, control, label, attributes, expanded: () => classes.has('is-expanded') };
}
function escape(document, prevented = false) {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperty(event, 'key', { value: 'Escape' });
  if (prevented) event.preventDefault();
  document.dispatchEvent(event);
}

test('Expand and Collapse persist the selected layout across episodes without changing other watch preferences', () => {
  const entries = new Map([['anijs_watch', '{"playbackMode":"direct","volume":0.6}']]);
  const storage = { getItem: key => entries.get(key) || null, setItem: (key, value) => entries.set(key, value) };
  const page = fixture(storage);
  assert.equal(page.expanded(), false);
  page.button.dispatchEvent(new Event('click'));
  assert.equal(page.expanded(), true);
  assert.equal(page.attributes.get('aria-pressed'), 'true');
  assert.equal(page.label.textContent, 'Collapse');
  const nextEpisode = fixture(storage);
  assert.equal(nextEpisode.expanded(), true);
  nextEpisode.button.dispatchEvent(new Event('click'));
  assert.equal(nextEpisode.expanded(), false);
  assert.equal(nextEpisode.label.textContent, 'Expand');
  assert.equal(entries.get('anijs_watch'), '{"playbackMode":"direct","volume":0.6}');
  page.control.destroy(); nextEpisode.control.destroy();
});

test('Escape collapses theater mode while fullscreen and handled keyboard events keep their own behavior', () => {
  const page = fixture(null);
  page.control.setExpanded(true);
  page.document.fullscreenElement = {};
  escape(page.document);
  assert.equal(page.expanded(), true);
  page.document.fullscreenElement = null;
  escape(page.document, true);
  assert.equal(page.expanded(), true);
  escape(page.document);
  assert.equal(page.expanded(), false);
  page.control.destroy();
  page.button.dispatchEvent(new Event('click'));
  assert.equal(page.expanded(), false);
});

test('storage failures leave the controls usable and both site languages have matching labels', () => {
  const page = fixture({ getItem() { throw new Error('disabled'); }, setItem() { throw new Error('full'); } });
  assert.equal(page.expanded(), false);
  page.button.dispatchEvent(new Event('click'));
  assert.equal(page.expanded(), true);
  escape(page.document);
  assert.equal(page.expanded(), false);
  assert.equal(languageLabel('Expand', 'id'), 'Perbesar');
  assert.equal(languageLabel('Collapse player', 'id'), 'Perkecil pemutar');
  assert.equal(languageLabel('Collapse', 'en'), 'Collapse');
  page.control.destroy();
});
