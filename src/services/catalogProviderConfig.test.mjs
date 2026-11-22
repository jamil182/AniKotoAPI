import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const command = fileURLToPath(new URL('../../scripts/set-catalog-provider.mjs', import.meta.url));
test('provider rollback preserves unrelated environment configuration and replaces only the two switches', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'aniyear-provider-'));
  try {
    await writeFile(path.join(cwd, 'server.js'), '');
    await writeFile(path.join(cwd, '.env'), '# CATALOG_PROVIDER=ignored\nEXAMPLE_VALUE=retain-this\nCATALOG_PROVIDER=anikoto\nSITE_THEME=classic\n');
    for (const [provider, theme] of [['miruro','miruro'],['anikoto','classic']]) {
      const result = spawnSync(process.execPath, [command, provider, theme], { cwd, encoding: 'utf8' });
      assert.equal(result.status, 0); const value = await readFile(path.join(cwd, '.env'), 'utf8');
      assert.match(value, /^EXAMPLE_VALUE=retain-this$/m); assert.match(value, /^# CATALOG_PROVIDER=ignored$/m);
      assert.equal(value.match(/^CATALOG_PROVIDER=/gm)?.length, 1); assert.ok(value.includes(`CATALOG_PROVIDER=${provider}\n`)); assert.ok(value.includes(`SITE_THEME=${theme}\n`));
      assert.ok(!result.stdout.includes('retain-this'));
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
test('invalid rollback arguments leave configuration untouched', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'aniyear-provider-'));
  try {
    await writeFile(path.join(cwd, '.env'), 'CATALOG_PROVIDER=miruro\n');
    const result = spawnSync(process.execPath, [command, 'unrecognized', 'classic'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(await readFile(path.join(cwd, '.env'), 'utf8'), 'CATALOG_PROVIDER=miruro\n');
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
