// Shared helpers for the CLI scripts. These talk to the Cloudflare API
// directly using env vars: CF_API_TOKEN, CF_ACCOUNT_ID. For local control
// plane work they shell out to wrangler d1 execute.
import { execFileSync } from 'node:child_process';

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`missing required env var ${name}`);
    process.exit(1);
  }
  return v;
}

const API = 'https://api.cloudflare.com/client/v4';

export async function cfFetch(path, init = {}) {
  const token = requireEnv('CF_API_TOKEN');
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(`Cloudflare API ${path}: ${JSON.stringify(json.errors)}`);
  }
  return json.result;
}

export async function d1Query(databaseId, sql, params = []) {
  const accountId = requireEnv('CF_ACCOUNT_ID');
  const result = await cfFetch(`/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: 'POST',
    body: JSON.stringify({ sql, params }),
  });
  return result?.[0]?.results ?? [];
}

export function wranglerD1Execute(databaseName, sql, { local = false } = {}) {
  const args = ['d1', 'execute', databaseName, '--command', sql, '--config', 'wrangler.toml'];
  if (local) args.push('--local');
  else args.push('--remote');
  return execFileSync('./node_modules/.bin/wrangler', args, { encoding: 'utf8' });
}
