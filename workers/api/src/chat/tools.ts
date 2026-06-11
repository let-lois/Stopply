// The assistant's tool surface. The model is offered only the tools the
// session's role permits, and executeTool re checks the role server side
// regardless of what the model or client requests. Every mutating tool
// follows the same protocol: propose, diff preview, explicit confirm,
// validate, apply, audit_log + chat_tool_log, one click revert.

import { z } from 'zod';
import type { Anthropic } from '@anthropic-ai/sdk';
import type { Role, TenantRow } from '@letlois/db';
import type { Env } from '../env';
import { tenantD1Client } from '../provisioning';
import { sanitizeViewConfig } from '../viewConfig';
import { sanitizeCss } from '../routes/settings';
import { hashPassword, randomToken } from '../crypto';
import { writeAudit } from '../audit';
import { clearResolverCache } from '../tenantResolver';

export interface ToolDefinition {
  schema: Anthropic.Tool;
  roles: Role[];
  codeMode?: boolean;
  // Loads the current state for the diff preview.
  before(env: Env, tenant: TenantRow, input: Record<string, unknown>): Promise<unknown>;
  // Validates and applies. Returns the after state.
  apply(env: Env, tenant: TenantRow, input: Record<string, unknown>): Promise<unknown>;
  // Restores the before state for revert.
  revert(env: Env, tenant: TenantRow, before: unknown, input: Record<string, unknown>): Promise<void>;
}

const ACCOUNT_ROLES: Role[] = ['account_admin', 'agency_staff', 'agency_admin'];

const targetsInput = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    targets: z.record(z.string().max(40), z.number().finite()),
  })
  .strict();

const themeInput = z.object({ tokens: z.record(z.string().max(40), z.string().max(20000)) }).strict();

const inviteInput = z
  .object({
    email: z.string().email(),
    name: z.string().min(1).max(120),
    role: z.enum(['account_admin', 'viewer']),
    viewConfig: z.unknown().optional(),
  })
  .strict();

const viewConfigInput = z.object({ userId: z.string().min(1).max(64), viewConfig: z.unknown() }).strict();
const verifySourceInput = z.object({ sourceKey: z.string().regex(/^[a-z0-9-]{1,60}$/) }).strict();
const labelsInput = z
  .object({
    lead: z.string().min(1).max(40),
    scheduled: z.string().min(1).max(40),
    completed: z.string().min(1).max(40),
    purchase: z.string().min(1).max(40),
  })
  .strict();

const layoutSchema = z
  .object({
    cards: z
      .array(
        z
          .object({
            id: z.string().min(1).max(40),
            type: z.enum(['kpi', 'channel-table', 'cohort', 'spend', 'quality', 'custom-kpi']),
            visible: z.boolean(),
            metricExpression: z.string().max(200).optional(),
            label: z.string().max(80).optional(),
          })
          .strict()
      )
      .max(30),
  })
  .strict();

const cssInput = z.object({ css: z.string().max(20000) }).strict();

function db(env: Env) {
  return tenantD1Client(env);
}

function dbId(tenant: TenantRow): string {
  if (!tenant.d1_database_id) throw new Error('tenant database missing');
  return tenant.d1_database_id;
}

export const TOOLS: Record<string, ToolDefinition> = {
  update_targets: {
    roles: ACCOUNT_ROLES,
    schema: {
      name: 'update_targets',
      description:
        'Set monthly targets for the tenant. Call this when the user asks to set, change, or update a goal or target for a month. Metrics: leads, scheduled, completed, revenue, spend.',
      input_schema: {
        type: 'object',
        properties: {
          month: { type: 'string', description: 'YYYY-MM' },
          targets: { type: 'object', description: 'metric name to numeric value map' },
        },
        required: ['month', 'targets'],
      },
    },
    async before(env, tenant, input) {
      const parsed = targetsInput.parse(input);
      const { results } = await db(env).query(dbId(tenant), `SELECT metric, value FROM targets WHERE period_month = ?`, [parsed.month]);
      return results;
    },
    async apply(env, tenant, input) {
      const parsed = targetsInput.parse(input);
      for (const [metric, value] of Object.entries(parsed.targets)) {
        await db(env).query(
          dbId(tenant),
          `INSERT INTO targets (period_month, metric, value) VALUES (?, ?, ?)
           ON CONFLICT (period_month, metric) DO UPDATE SET value = excluded.value`,
          [parsed.month, metric, value]
        );
      }
      return parsed.targets;
    },
    async revert(env, tenant, before, input) {
      const parsed = targetsInput.parse(input);
      await db(env).query(dbId(tenant), `DELETE FROM targets WHERE period_month = ?`, [parsed.month]);
      for (const row of (before as Array<{ metric: string; value: number }>) ?? []) {
        await db(env).query(
          dbId(tenant),
          `INSERT INTO targets (period_month, metric, value) VALUES (?, ?, ?)`,
          [parsed.month, row.metric, row.value]
        );
      }
    },
  },

  update_theme_tokens: {
    roles: ACCOUNT_ROLES,
    schema: {
      name: 'update_theme_tokens',
      description:
        'Update one or more theme tokens (colors as #RRGGBB hex, font names, or the wordmark). Call this when the user asks to change brand colors, fonts, or the dashboard look.',
      input_schema: {
        type: 'object',
        properties: { tokens: { type: 'object', description: 'token name to value map, merged into the existing theme' } },
        required: ['tokens'],
      },
    },
    async before(_env, tenant) {
      return tenant.theme_json ? JSON.parse(tenant.theme_json) : null;
    },
    async apply(env, tenant, input) {
      const parsed = themeInput.parse(input);
      const current = tenant.theme_json ? (JSON.parse(tenant.theme_json) as Record<string, string>) : {};
      for (const [key, value] of Object.entries(parsed.tokens)) {
        if (key === 'customCss') continue; // custom CSS has its own code mode tool
        if (/^(paper|card|ink|inkSoft|hairline|accent|accentSoft|positive|negative|amber|verifiedGreen|grayCheck|redCheck|channelGoogle|channelMeta|channelWebsite)$/.test(key)) {
          if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`token ${key} must be #RRGGBB hex`);
        }
        if (value.length > 80) throw new Error(`token ${key} value too long`);
        current[key] = value;
      }
      await env.CONTROL_DB.prepare(`UPDATE tenants SET theme_json = ? WHERE id = ?`)
        .bind(JSON.stringify(current), tenant.id)
        .run();
      clearResolverCache();
      return current;
    },
    async revert(env, tenant, before) {
      await env.CONTROL_DB.prepare(`UPDATE tenants SET theme_json = ? WHERE id = ?`)
        .bind(before === null ? null : JSON.stringify(before), tenant.id)
        .run();
      clearResolverCache();
    },
  },

  upload_logo_prompt: {
    roles: ACCOUNT_ROLES,
    schema: {
      name: 'upload_logo_prompt',
      description: 'Returns a deep link to the logo uploader. Call this when the user wants to change or upload their logo. This tool changes nothing itself.',
      input_schema: { type: 'object', properties: {} },
    },
    async before() {
      return null;
    },
    async apply() {
      return { deepLink: '/#data-team-settings-logo', note: 'Open Data and Team, Settings, Logo to upload.' };
    },
    async revert() {
      // nothing to revert: this tool only returns a link
    },
  },

  invite_user: {
    roles: ACCOUNT_ROLES,
    schema: {
      name: 'invite_user',
      description:
        'Invite a user to this tenant dashboard. Call when the user asks to add a teammate. role is account_admin or viewer; viewers can take a view config.',
      input_schema: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          name: { type: 'string' },
          role: { type: 'string', enum: ['account_admin', 'viewer'] },
          viewConfig: { type: 'object', description: 'optional viewer config: tabs, months, channels' },
        },
        required: ['email', 'name', 'role'],
      },
    },
    async before(env, tenant, input) {
      const parsed = inviteInput.parse(input);
      const { results } = await db(env).query(dbId(tenant), `SELECT id FROM users WHERE email = ?`, [
        parsed.email.toLowerCase(),
      ]);
      return { exists: results.length > 0 };
    },
    async apply(env, tenant, input) {
      const parsed = inviteInput.parse(input);
      const email = parsed.email.toLowerCase().trim();
      const existing = await db(env).query(dbId(tenant), `SELECT id FROM users WHERE email = ?`, [email]);
      if (existing.results.length > 0) throw new Error('a user with that email already exists');
      const tempPassword = randomToken(9);
      const id = `u_${randomToken(8)}`;
      await db(env).query(
        dbId(tenant),
        `INSERT INTO users (id, email, name, role, password_hash, view_config_json, active) VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [
          id,
          email,
          parsed.name,
          parsed.role,
          await hashPassword(tempPassword),
          parsed.role === 'viewer' ? JSON.stringify(sanitizeViewConfig(parsed.viewConfig)) : null,
        ]
      );
      await env.CONTROL_DB.prepare(`INSERT OR IGNORE INTO tenant_directory (email, tenant_id) VALUES (?, ?)`)
        .bind(email, tenant.id)
        .run();
      return { id, email, role: parsed.role, tempPassword };
    },
    async revert(env, tenant, _before, input) {
      const parsed = inviteInput.parse(input);
      await db(env).query(dbId(tenant), `DELETE FROM users WHERE email = ? AND created_at > datetime('now', '-1 hour')`, [
        parsed.email.toLowerCase(),
      ]);
    },
  },

  update_view_config: {
    roles: ACCOUNT_ROLES,
    schema: {
      name: 'update_view_config',
      description:
        'Update a viewer user view config: which tabs (performance, work-backwards, planning), months, and channels they can see. Present and Data and Team are never grantable.',
      input_schema: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          viewConfig: { type: 'object', description: 'tabs (array), months (array of YYYY-MM or "all"), channels (array or "all")' },
        },
        required: ['userId', 'viewConfig'],
      },
    },
    async before(env, tenant, input) {
      const parsed = viewConfigInput.parse(input);
      const { results } = await db(env).query<{ view_config_json: string | null }>(
        dbId(tenant),
        `SELECT view_config_json FROM users WHERE id = ?`,
        [parsed.userId]
      );
      return results[0]?.view_config_json ? JSON.parse(results[0].view_config_json) : null;
    },
    async apply(env, tenant, input) {
      const parsed = viewConfigInput.parse(input);
      const sanitized = sanitizeViewConfig(parsed.viewConfig);
      await db(env).query(dbId(tenant), `UPDATE users SET view_config_json = ? WHERE id = ? AND role = 'viewer'`, [
        JSON.stringify(sanitized),
        parsed.userId,
      ]);
      return sanitized;
    },
    async revert(env, tenant, before, input) {
      const parsed = viewConfigInput.parse(input);
      await db(env).query(dbId(tenant), `UPDATE users SET view_config_json = ? WHERE id = ?`, [
        before === null ? null : JSON.stringify(before),
        parsed.userId,
      ]);
    },
  },

  verify_source: {
    roles: ACCOUNT_ROLES,
    schema: {
      name: 'verify_source',
      description: 'Mark a data source as verified after the user confirms they checked the numbers against the platform.',
      input_schema: {
        type: 'object',
        properties: { sourceKey: { type: 'string', description: 'the source key, for example meta-csv' } },
        required: ['sourceKey'],
      },
    },
    async before(env, tenant, input) {
      const parsed = verifySourceInput.parse(input);
      const { results } = await db(env).query(dbId(tenant), `SELECT verified_by, verified_at FROM sources WHERE key = ?`, [
        parsed.sourceKey,
      ]);
      return results[0] ?? null;
    },
    async apply(env, tenant, input) {
      const parsed = verifySourceInput.parse(input);
      await db(env).query(
        dbId(tenant),
        `UPDATE sources SET verified_by = 'chat', verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = ?`,
        [parsed.sourceKey]
      );
      return { verified: true, sourceKey: parsed.sourceKey };
    },
    async revert(env, tenant, before, input) {
      const parsed = verifySourceInput.parse(input);
      const prev = (before as { verified_by: string | null; verified_at: string | null } | null) ?? {
        verified_by: null,
        verified_at: null,
      };
      await db(env).query(dbId(tenant), `UPDATE sources SET verified_by = ?, verified_at = ? WHERE key = ?`, [
        prev.verified_by,
        prev.verified_at,
        parsed.sourceKey,
      ]);
    },
  },

  set_funnel_labels: {
    roles: ACCOUNT_ROLES,
    schema: {
      name: 'set_funnel_labels',
      description:
        'Rename the four funnel stages shown across the dashboard. Call when the user wants different stage names, for example Jobs Booked instead of Scheduled.',
      input_schema: {
        type: 'object',
        properties: {
          lead: { type: 'string' },
          scheduled: { type: 'string' },
          completed: { type: 'string' },
          purchase: { type: 'string' },
        },
        required: ['lead', 'scheduled', 'completed', 'purchase'],
      },
    },
    async before(_env, tenant) {
      return tenant.funnel_labels_json ? JSON.parse(tenant.funnel_labels_json) : null;
    },
    async apply(env, tenant, input) {
      const parsed = labelsInput.parse(input);
      await env.CONTROL_DB.prepare(`UPDATE tenants SET funnel_labels_json = ? WHERE id = ?`)
        .bind(JSON.stringify(parsed), tenant.id)
        .run();
      clearResolverCache();
      return parsed;
    },
    async revert(env, tenant, before) {
      await env.CONTROL_DB.prepare(`UPDATE tenants SET funnel_labels_json = ? WHERE id = ?`)
        .bind(before === null ? null : JSON.stringify(before), tenant.id)
        .run();
      clearResolverCache();
    },
  },

  // Code mode tools: agency_admin only, and only when code mode is on.
  edit_layout_json: {
    roles: ['agency_admin'],
    codeMode: true,
    schema: {
      name: 'edit_layout_json',
      description:
        'Replace the tenant dashboard layout definition: card order, visibility, and custom KPI cards bound to metric expressions. Validated against a schema before applying.',
      input_schema: {
        type: 'object',
        properties: {
          layout: {
            type: 'object',
            description: 'object with cards: [{id, type, visible, metricExpression?, label?}]',
          },
        },
        required: ['layout'],
      },
    },
    async before(_env, tenant) {
      return tenant.layout_json ? JSON.parse(tenant.layout_json) : null;
    },
    async apply(env, tenant, input) {
      const layout = layoutSchema.parse((input as { layout: unknown }).layout);
      await env.CONTROL_DB.prepare(`UPDATE tenants SET layout_json = ? WHERE id = ?`)
        .bind(JSON.stringify(layout), tenant.id)
        .run();
      clearResolverCache();
      return layout;
    },
    async revert(env, tenant, before) {
      await env.CONTROL_DB.prepare(`UPDATE tenants SET layout_json = ? WHERE id = ?`)
        .bind(before === null ? null : JSON.stringify(before), tenant.id)
        .run();
      clearResolverCache();
    },
  },

  edit_custom_css: {
    roles: ['agency_admin'],
    codeMode: true,
    schema: {
      name: 'edit_custom_css',
      description:
        'Replace the tenant custom CSS. The CSS is sanitized server side and scoped to the tenant app container on render.',
      input_schema: {
        type: 'object',
        properties: { css: { type: 'string' } },
        required: ['css'],
      },
    },
    async before(_env, tenant) {
      const theme = tenant.theme_json ? (JSON.parse(tenant.theme_json) as Record<string, string>) : {};
      return theme.customCss ?? '';
    },
    async apply(env, tenant, input) {
      const parsed = cssInput.parse(input);
      const sanitized = sanitizeCss(parsed.css);
      const theme = tenant.theme_json ? (JSON.parse(tenant.theme_json) as Record<string, string>) : {};
      theme.customCss = sanitized;
      await env.CONTROL_DB.prepare(`UPDATE tenants SET theme_json = ? WHERE id = ?`)
        .bind(JSON.stringify(theme), tenant.id)
        .run();
      clearResolverCache();
      return sanitized;
    },
    async revert(env, tenant, before) {
      const theme = tenant.theme_json ? (JSON.parse(tenant.theme_json) as Record<string, string>) : {};
      theme.customCss = (before as string) ?? '';
      await env.CONTROL_DB.prepare(`UPDATE tenants SET theme_json = ? WHERE id = ?`)
        .bind(JSON.stringify(theme), tenant.id)
        .run();
      clearResolverCache();
    },
  },

  /*
   * propose_code_change: disabled stub, intentionally unreachable in v1.
   *
   * A future flow where the assistant proposes an actual source change:
   * 1. The assistant drafts a patch against the dashboard repo.
   * 2. The server opens a GitHub pull request via the GitHub API using a
   *    repo scoped token (new secret GITHUB_PR_TOKEN), targeting a
   *    protected branch with required review.
   * 3. The chat shows the PR link; merging stays a human decision in
   *    GitHub. Nothing deploys from chat.
   *
   * It is registered nowhere: not in TOOLS, never offered to the model,
   * and executeTool cannot reach it. Keep it that way until the PR flow
   * is designed and reviewed.
   *
   * const proposeCodeChange: ToolDefinition = {
   *   roles: ['agency_admin'],
   *   codeMode: true,
   *   schema: {
   *     name: 'propose_code_change',
   *     description: 'Open a GitHub pull request with a proposed source change.',
   *     input_schema: { type: 'object', properties: { title: { type: 'string' }, patch: { type: 'string' } } },
   *   },
   *   ...
   * };
   */
};

export function toolsForSession(role: Role, codeMode: boolean): Anthropic.Tool[] {
  return Object.values(TOOLS)
    .filter((t) => t.roles.includes(role))
    .filter((t) => !t.codeMode || (codeMode && role === 'agency_admin'))
    .map((t) => t.schema);
}

export function canUseTool(role: Role, toolName: string, codeMode: boolean): boolean {
  const tool = TOOLS[toolName];
  if (!tool) return false;
  if (!tool.roles.includes(role)) return false;
  if (tool.codeMode && (!codeMode || role !== 'agency_admin')) return false;
  return true;
}

export async function logToolCall(
  env: Env,
  entry: {
    tenantId: string | null;
    userId: string;
    role: string;
    toolName: string;
    input: unknown;
    result: string;
    before?: unknown;
    after?: unknown;
  }
): Promise<string> {
  const id = `ct_${randomToken(8)}`;
  await env.CONTROL_DB.prepare(
    `INSERT INTO chat_tool_log (id, tenant_id, user_id, role, tool_name, input_json, result, reverted)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
  )
    .bind(id, entry.tenantId, entry.userId, entry.role, entry.toolName, JSON.stringify(entry.input), entry.result)
    .run();
  await writeAudit(env, {
    actorType: 'chat',
    actorId: entry.userId,
    tenantId: entry.tenantId,
    action: `chat.${entry.toolName}`,
    target: entry.result,
    before: entry.before,
    after: entry.after,
  });
  return id;
}
