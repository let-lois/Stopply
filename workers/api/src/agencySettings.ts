// Agency managed configuration: a small, curated set of platform keys and
// secrets that an agency admin can rotate from the console instead of
// editing code or running `wrangler secret put`. Secret values are stored
// AES-GCM encrypted under CRED_MASTER_KEY and never leave the server in
// plaintext; reads return only whether a value is set and when.

import type { Env } from './env';
import { encryptCredentials, decryptCredentials } from './crypto';

export interface ManagedKey {
  key: string;
  label: string;
  secret: boolean;
  help: string;
  // The env binding this value also exists as, used as the fallback so the
  // platform keeps working until a value is set in the console.
  envFallback?: keyof Env;
}

// CRED_MASTER_KEY is deliberately excluded: it is the key that encrypts
// everything else here, so rotating it from the console would orphan every
// stored value. It stays a bootstrap secret set out of band.
export const MANAGED_KEYS: ManagedKey[] = [
  { key: 'CF_API_TOKEN', label: 'Cloudflare API token', secret: true, help: 'Scoped token: D1 edit + Custom Hostnames edit.', envFallback: 'CF_API_TOKEN' },
  { key: 'CF_ACCOUNT_ID', label: 'Cloudflare account id', secret: false, help: 'Account id for the D1 REST and HTTP query APIs.', envFallback: 'CF_ACCOUNT_ID' },
  { key: 'CF_ZONE_ID', label: 'Cloudflare zone id', secret: false, help: 'Zone id for custom hostnames.', envFallback: 'CF_ZONE_ID' },
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', secret: true, help: 'Powers the chat assistant and AI CSV parsing.', envFallback: 'ANTHROPIC_API_KEY' },
  { key: 'INGEST_PEPPER', label: 'Ingest pepper', secret: true, help: 'IP hashing and webhook signing secret derivation.', envFallback: 'INGEST_PEPPER' },
];

const KEY_SET = new Set(MANAGED_KEYS.map((k) => k.key));

export function isManagedKey(key: string): boolean {
  return KEY_SET.has(key);
}

interface SettingRow {
  key: string;
  is_secret: number;
  value_ciphertext: string | null;
  value_iv: string | null;
  value_plain: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

// Status for the console: which keys are set, where the live value comes
// from (console override vs. env fallback), and when it was last changed.
export async function listAgencySettings(
  env: Env
): Promise<Array<ManagedKey & { isSet: boolean; source: 'console' | 'env' | 'unset'; updatedAt: string | null; updatedBy: string | null }>> {
  const { results } = await env.CONTROL_DB.prepare(
    `SELECT key, is_secret, value_ciphertext, value_iv, value_plain, updated_by, updated_at FROM agency_settings`
  ).all<SettingRow>();
  const byKey = new Map(results.map((r) => [r.key, r]));
  return MANAGED_KEYS.map((mk) => {
    const row = byKey.get(mk.key);
    const hasConsole = !!row && (row.value_ciphertext !== null || row.value_plain !== null);
    const hasEnv = !!(mk.envFallback && env[mk.envFallback]);
    return {
      ...mk,
      isSet: hasConsole || hasEnv,
      source: hasConsole ? 'console' : hasEnv ? 'env' : 'unset',
      updatedAt: row?.updated_at ?? null,
      updatedBy: row?.updated_by ?? null,
    };
  });
}

export async function setAgencySetting(env: Env, key: string, value: string, updatedBy: string): Promise<void> {
  const mk = MANAGED_KEYS.find((m) => m.key === key);
  if (!mk) throw new Error('unknown setting');
  if (mk.secret) {
    const { ciphertext, iv } = await encryptCredentials(env.CRED_MASTER_KEY, value);
    await env.CONTROL_DB.prepare(
      `INSERT INTO agency_settings (key, is_secret, value_ciphertext, value_iv, value_plain, updated_by, updated_at)
       VALUES (?, 1, ?, ?, NULL, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT (key) DO UPDATE SET value_ciphertext = excluded.value_ciphertext,
         value_iv = excluded.value_iv, value_plain = NULL, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    )
      .bind(key, ciphertext, iv, updatedBy)
      .run();
  } else {
    await env.CONTROL_DB.prepare(
      `INSERT INTO agency_settings (key, is_secret, value_ciphertext, value_iv, value_plain, updated_by, updated_at)
       VALUES (?, 0, NULL, NULL, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT (key) DO UPDATE SET value_plain = excluded.value_plain, value_ciphertext = NULL,
         value_iv = NULL, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    )
      .bind(key, value, updatedBy)
      .run();
  }
}

// Resolve the live value for a managed key: a console override wins, then
// the wrangler env binding. Used by the platform so console edits take
// effect without a redeploy.
export async function getAgencySetting(env: Env, key: string): Promise<string | null> {
  const mk = MANAGED_KEYS.find((m) => m.key === key);
  const row = await env.CONTROL_DB.prepare(
    `SELECT key, is_secret, value_ciphertext, value_iv, value_plain, updated_by, updated_at FROM agency_settings WHERE key = ?`
  )
    .bind(key)
    .first<SettingRow>();
  if (row) {
    if (row.value_plain !== null) return row.value_plain;
    if (row.value_ciphertext && row.value_iv) {
      try {
        return await decryptCredentials(env.CRED_MASTER_KEY, row.value_ciphertext, row.value_iv);
      } catch {
        /* fall through to env */
      }
    }
  }
  if (mk?.envFallback) return (env[mk.envFallback] as string | undefined) ?? null;
  return null;
}

// Whether an agency session may manage secrets. Admins always may; staff
// only with the explicit permission flag.
export function canManageSecrets(role: string, permissionsJson: string | null): boolean {
  if (role === 'agency_admin') return true;
  if (!permissionsJson) return false;
  try {
    const perms = JSON.parse(permissionsJson) as Record<string, boolean>;
    return perms.manageSecrets === true;
  } catch {
    return false;
  }
}
