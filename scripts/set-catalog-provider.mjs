import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const [provider, theme] = process.argv.slice(2);
if (!['anikoto','miruro'].includes(provider) || !['classic','miruro'].includes(theme)) {
  process.stderr.write('Usage: node scripts/set-catalog-provider.mjs <anikoto|miruro> <classic|miruro>\n');
  process.exitCode = 1;
} else {
  try {
    const file = path.resolve('.env'), original = await readFile(file, 'utf8'), metadata = await stat(file);
    await stat(path.resolve('server.js'));
    let updated = original;
    for (const [key, value] of Object.entries({ CATALOG_PROVIDER: provider, SITE_THEME: theme })) {
      const pattern = new RegExp(`^${key}=.*$`, 'm');
      updated = pattern.test(updated) ? updated.replace(pattern, `${key}=${value}`) : updated.replace(/\s*$/, '') + `\n${key}=${value}\n`;
    }
    await writeFile(file, updated, { mode: metadata.mode });
    process.stdout.write(`Saved provider=${provider}, theme=${theme}. Restart only the anijs project in aaPanel.\n`);
  } catch {
    process.stderr.write('Could not update .env. Run this command from the Aniyear application directory with permission to edit .env.\n'); process.exitCode = 1;
  }
}
