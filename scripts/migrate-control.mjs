// Applies control plane migrations to the bound D1 database via wrangler.
// Usage: pnpm migrate:control [--local]
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'packages/db/migrations/control');
const local = process.argv.includes('--local');

for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  console.log(`applying ${file} (${local ? 'local' : 'remote'})`);
  execFileSync(
    join(root, 'node_modules/.bin/wrangler'),
    [
      'd1',
      'execute',
      'letlois-bi-control',
      '--file',
      join(dir, file),
      '--config',
      join(root, 'wrangler.toml'),
      local ? '--local' : '--remote',
    ],
    { stdio: 'inherit', cwd: root }
  );
}
console.log('control plane migrations applied');
