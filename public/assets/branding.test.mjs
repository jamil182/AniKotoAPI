import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBranding, brandingUrls } from './branding.js';

const branding = { logo: '/logo.png?v=' + 'a'.repeat(24), favicon: '/favicon.png?v=' + 'b'.repeat(24) };

test('branding accepts only versioned local artwork and rejects external or malformed URLs', () => {
  assert.deepEqual(brandingUrls(branding), branding);
  for (const value of [null, [], {}, { ...branding, logo: 'https://attacker.example/logo.png' },
    { ...branding, favicon: 'javascript:alert(1)' }, { ...branding, logo: '/logo.png?v=<script>' }]) {
    assert.equal(brandingUrls(value), null);
  }
});

test('branding updates logo and icon URLs without altering unrelated images or repeating writes', () => {
  let writes = 0;
  const node = attribute => {
    const fields = { [attribute]: '/old.png' };
    return { getAttribute: key => fields[key], setAttribute: (key, value) => { fields[key] = value; writes++; } };
  };
  const logo = node('src'), icon = node('href');
  const page = { querySelectorAll: selector => selector.startsWith('.logo') ? [logo] : [icon] };
  assert.equal(applyBranding(page, branding), true);
  assert.equal(logo.getAttribute('src'), branding.logo);
  assert.equal(icon.getAttribute('href'), branding.favicon);
  assert.equal(writes, 2);
  applyBranding(page, branding);
  assert.equal(writes, 2);
  assert.equal(applyBranding(page, null), false);
  assert.equal(writes, 2);
});
