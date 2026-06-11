import {
  DEFAULT_FUNNEL_LABELS,
  DEFAULT_LAYOUT,
  LETLOIS_THEME,
  type FunnelLabels,
  type TenantRow,
} from '@letlois/db';
import { TENANT_MIGRATIONS, splitStatements } from '@letlois/db/migrations';
import { TenantD1, createTenantDatabase } from '@letlois/tenant-d1';
import type { Env } from './env';
import { hashPassword, randomToken, sha256Hex } from './crypto';
import { writeAudit } from './audit';
import { clearResolverCache } from './tenantResolver';

export interface ProvisionInput {
  slug: string;
  name: string;
  timezone?: string;
  plan?: 'starter' | 'pro' | 'whitelabel';
  adminEmail: string;
  adminName: string;
  funnelLabels?: FunnelLabels;
  themeJson?: string;
  actor: { id: string; name: string };
}

export interface ProvisionResult {
  tenantId: string;
  slug: string;
  databaseId: string;
  adminEmail: string;
  // Returned exactly once at provision time, never stored in plaintext.
  tempPassword: string | null;
  resumed: boolean;
}

export function tenantD1Client(env: Env): TenantD1 {
  return new TenantD1({ accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN });
}

export const DEFAULT_SOURCES: Array<{
  key: string;
  name: string;
  kind: 'webhook' | 'pixel' | 'csv' | 'integration';
  connector_type: string | null;
  cadence: number;
  how_to: string;
}> = [
  {
    key: 'ghl-webhook',
    name: 'GHL Webhook',
    kind: 'webhook',
    connector_type: null,
    cadence: 7,
    how_to: 'In GHL, add a webhook to your workflow pointed at the ingest URL shown here. Sign requests with the secret shown once at creation.',
  },
  {
    key: 'website-pixel',
    name: 'Website Pixel',
    kind: 'pixel',
    connector_type: null,
    cadence: 7,
    how_to: 'Install the tracking script on every page of the website. Copy the snippet from Data and Team.',
  },
  {
    key: 'meta-csv',
    name: 'Meta Ads CSV',
    kind: 'csv',
    connector_type: 'meta-campaign',
    cadence: 7,
    how_to: 'Ads Manager, Reports, export campaign results by month as CSV, then upload it here.',
  },
  {
    key: 'google-csv',
    name: 'Google Ads CSV',
    kind: 'csv',
    connector_type: 'google-campaign',
    cadence: 7,
    how_to: 'Google Ads, Campaigns, download the month as CSV, then upload it here.',
  },
  {
    key: 'boulevard',
    name: 'Boulevard',
    kind: 'integration',
    connector_type: 'boulevard',
    cadence: 1,
    how_to: 'Connect Boulevard from the Integrations hub with your API key and business id.',
  },
  {
    key: 'housecallpro',
    name: 'Housecall Pro',
    kind: 'integration',
    connector_type: 'housecallpro',
    cadence: 1,
    how_to: 'Connect Housecall Pro from the Integrations hub with your API key.',
  },
  {
    key: 'jobber',
    name: 'Jobber',
    kind: 'integration',
    connector_type: 'jobber',
    cadence: 1,
    how_to: 'Connect Jobber from the Integrations hub via OAuth.',
  },
];

export async function applyTenantMigrations(
  env: Env,
  databaseId: string,
  fromVersion: number
): Promise<number> {
  const d1 = tenantD1Client(env);
  let version = fromVersion;
  for (const migration of TENANT_MIGRATIONS) {
    if (migration.version <= fromVersion) continue;
    for (const stmt of splitStatements(migration.sql)) {
      await d1.query(databaseId, stmt);
    }
    version = migration.version;
  }
  return version;
}

export async function provisionTenant(env: Env, input: ProvisionInput): Promise<ProvisionResult> {
  const slug = input.slug.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!slug) throw new Error('invalid slug');

  // Idempotent on slug: a retry resumes where the last attempt stopped.
  const existing = await env.CONTROL_DB.prepare(`SELECT * FROM tenants WHERE slug = ?`)
    .bind(slug)
    .first<TenantRow>();

  const tenantId = existing?.id ?? `t_${randomToken(8)}`;
  const dbName = existing?.d1_database_name ?? `lbi-tenant-${slug}`;

  let databaseId = existing?.d1_database_id ?? null;
  if (!databaseId) {
    const created = await createTenantDatabase(
      { accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN },
      dbName
    );
    databaseId = created.uuid;
  }

  const schemaVersion = await applyTenantMigrations(env, databaseId, existing?.schema_version ?? 0);

  if (!existing) {
    await env.CONTROL_DB.prepare(
      `INSERT INTO tenants (id, slug, name, status, plan, timezone, d1_database_id, d1_database_name,
        schema_version, theme_json, layout_json, footer_credit, funnel_labels_json)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
      .bind(
        tenantId,
        slug,
        input.name,
        input.plan ?? 'starter',
        input.timezone ?? 'America/Phoenix',
        databaseId,
        dbName,
        schemaVersion,
        input.themeJson ?? JSON.stringify(LETLOIS_THEME),
        JSON.stringify(DEFAULT_LAYOUT),
        JSON.stringify(input.funnelLabels ?? DEFAULT_FUNNEL_LABELS)
      )
      .run();
  } else {
    await env.CONTROL_DB.prepare(
      `UPDATE tenants SET d1_database_id = ?, d1_database_name = ?, schema_version = ? WHERE id = ?`
    )
      .bind(databaseId, dbName, schemaVersion, tenantId)
      .run();
  }

  const d1 = tenantD1Client(env);

  // Seed default sources. INSERT OR IGNORE keeps the retry path clean.
  for (const s of DEFAULT_SOURCES) {
    await d1.query(
      databaseId,
      `INSERT OR IGNORE INTO sources (key, name, kind, connector_type, cadence, how_to) VALUES (?, ?, ?, ?, ?, ?)`,
      [s.key, s.name, s.kind, s.connector_type, s.cadence, s.how_to]
    );
  }

  // First account_admin. The temp password is returned exactly once.
  const adminEmail = input.adminEmail.toLowerCase().trim();
  const existingAdmin = await d1.query(databaseId, `SELECT id FROM users WHERE email = ?`, [adminEmail]);
  let tempPassword: string | null = null;
  if (existingAdmin.results.length === 0) {
    tempPassword = randomToken(9);
    const passwordHash = await hashPassword(tempPassword);
    await d1.query(
      databaseId,
      `INSERT INTO users (id, email, name, role, password_hash, active) VALUES (?, ?, ?, 'account_admin', ?, 1)`,
      [`u_${randomToken(8)}`, adminEmail, input.adminName, passwordHash]
    );
    await env.CONTROL_DB.prepare(
      `INSERT OR IGNORE INTO tenant_directory (email, tenant_id) VALUES (?, ?)`
    )
      .bind(adminEmail, tenantId)
      .run();
  }

  await writeAudit(env, {
    actorType: 'agency',
    actorId: input.actor.id,
    actorName: input.actor.name,
    tenantId,
    action: existing ? 'tenant.provision.resume' : 'tenant.provision',
    target: slug,
    after: { slug, name: input.name, databaseId, schemaVersion },
  });

  clearResolverCache();
  return { tenantId, slug, databaseId, adminEmail, tempPassword, resumed: !!existing };
}

// Generates a signing secret for a webhook source. The plaintext is shown
// once; only its hash is stored.
export async function rotateSourceSecret(
  env: Env,
  databaseId: string,
  sourceKey: string
): Promise<string> {
  const secret = randomToken(24);
  const hash = await sha256Hex(secret);
  const d1 = tenantD1Client(env);
  await d1.query(databaseId, `UPDATE sources SET signing_secret_hash = ? WHERE key = ?`, [
    hash,
    sourceKey,
  ]);
  return secret;
}
