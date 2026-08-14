// Starts qa/bi-api-fake.mjs for the run, and stops it after.
//
// A separate file rather than a beforeAll inside the test, because the test
// lives under src/ and src/ is typed for a browser. Importing node:child_process
// there would mean giving the whole application project node types, which is
// exactly the loosening that lets a Node-only global slip into code that ships
// to a browser. The lifecycle belongs out here; the test only speaks HTTP.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const PORT = 8791;
const here = dirname(fileURLToPath(import.meta.url));

let child;

export async function setup() {
  child = spawn(process.execPath, [resolve(here, 'bi-api-fake.mjs')], {
    env: { ...process.env, BI_FAKE_PORT: String(PORT) },
    stdio: 'ignore',
  });

  // Polled rather than slept. A fixed delay is either too short on a loaded
  // machine, which is a flaky suite, or too long on every run.
  for (let i = 0; i < 100; i += 1) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/api/auth/me`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`the bi.letlois.com fake did not come up on ${PORT}`);
}

export function teardown() {
  child?.kill();
}
