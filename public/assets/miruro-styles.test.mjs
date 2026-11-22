import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMiruroStyles } from './miruro-styles.js';

function pageFixture() {
  const links = [];
  const page = {
    createElement: () => {
      const link = new EventTarget();
      link.remove = () => links.splice(links.indexOf(link), 1);
      return link;
    },
    head: { append: link => links.push(link) },
  };
  return { page, links };
}

test('theme readiness waits for CSS load and concurrent mounts share the same stylesheet', async () => {
  const { page, links } = pageFixture();
  let ready = false;
  const first = loadMiruroStyles(page);
  first.then(() => { ready = true; });
  assert.equal(loadMiruroStyles(page), first);
  assert.equal(links.length, 1);
  assert.equal(links[0].rel, 'stylesheet');
  await Promise.resolve();
  assert.equal(ready, false, 'unstyled navigation must not mount while CSS is pending');
  links[0].dispatchEvent(new Event('load'));
  await first;
  assert.equal(ready, true);
  assert.equal(loadMiruroStyles(page), first);
});

test('failed stylesheets are removed and a later mount can retry', async () => {
  const { page, links } = pageFixture();
  const first = loadMiruroStyles(page);
  links[0].dispatchEvent(new Event('error'));
  await assert.rejects(first, /could not load/);
  assert.equal(links.length, 0);
  const retry = loadMiruroStyles(page);
  links[0].dispatchEvent(new Event('load'));
  await retry;
});

test('a stalled stylesheet times out without leaving unstyled theme elements enabled', async () => {
  const { page, links } = pageFixture();
  await assert.rejects(loadMiruroStyles(page, { timeoutMs: 5 }), /timed out/);
  assert.equal(links.length, 0);
});
