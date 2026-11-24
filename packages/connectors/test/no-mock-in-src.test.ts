// Mock Apple Ads figures are for tests. Nothing that ships may import them,
// or a client could be shown invented numbers as their own performance.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..', '..');
const shipped = ['packages/connectors/src', 'packages/db/src', 'workers/api/src', 'workers/sync/src', 'apps/web/src'];

function files(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(files(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('mock fixtures stay in tests', () => {
  it('no shipped source imports the Apple Ads mock fixtures', () => {
    const offenders = shipped
      .flatMap((d) => files(join(root, d)))
      .filter((f) => /fixtures\/apple-maps-ads|appleAdsMock|mockSigningKeys/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
