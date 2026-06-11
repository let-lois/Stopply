import { Hono } from 'hono';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import type { SourceRow } from '@letlois/db';
import { sourceFreshness } from '@letlois/db';
import type { AppContext } from '../env';
import { requireAuth, tenantScope } from '../middleware';
import { tenantD1Client } from '../provisioning';
import { LIMITS, rateLimit } from '../ratelimit';
import { TOOLS, canUseTool, logToolCall, toolsForSession } from '../chat/tools';

export const helpRoutes = new Hono<AppContext>();
helpRoutes.use('*', requireAuth);

// Full text help search over published articles. SQLite LIKE based: ten
// seeded articles do not need FTS5.
helpRoutes.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').slice(0, 100).trim();
  if (!q) {
    const { results } = await c.env.CONTROL_DB.prepare(
      `SELECT slug, title, tags FROM help_articles WHERE published = 1 ORDER BY title LIMIT 20`
    ).all();
    return c.json({ articles: results });
  }
  const pattern = `%${q.replace(/[%_]/g, '')}%`;
  const { results } = await c.env.CONTROL_DB.prepare(
    `SELECT slug, title, tags FROM help_articles
     WHERE published = 1 AND (title LIKE ? OR body_md LIKE ? OR tags LIKE ?)
     ORDER BY title LIMIT 10`
  )
    .bind(pattern, pattern, pattern)
    .all();
  return c.json({ articles: results });
});

helpRoutes.get('/articles/:slug', async (c) => {
  const slug = c.req.param('slug');
  const article = await c.env.CONTROL_DB.prepare(
    `SELECT slug, title, body_md, tags FROM help_articles WHERE slug = ? AND published = 1`
  )
    .bind(slug)
    .first();
  if (!article) return c.json({ error: 'not found' }, 404);
  return c.json({ article });
});

export const chatRoutes = new Hono<AppContext>();
chatRoutes.use('*', tenantScope);

const chatSchema = z
  .object({
    messages: z
      .array(
        z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(8000) }).strict()
      )
      .min(1)
      .max(30),
    currentTab: z.string().max(30).optional(),
    codeMode: z.boolean().default(false),
  })
  .strict();

// The assistant call. Context per request: role, funnel labels, current
// tab, the source list with freshness, and the top matching help
// articles. The model is offered only the tools this role permits; it
// proposes tool calls but nothing executes here.
chatRoutes.post('/', async (c) => {
  const session = c.get('session')!;
  const tenant = c.get('tenant')!;
  if (!(await rateLimit(c.env, LIMITS.chatUser, session.userId))) {
    return c.json({ error: 'slow down a moment' }, 429);
  }
  const body = chatSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);

  // Code mode is re verified server side: a forged flag from a lesser
  // role changes nothing.
  const codeMode = body.data.codeMode && session.role === 'agency_admin';

  const d1 = tenantD1Client(c.env);
  const { results: sources } = await d1.query<SourceRow>(
    tenant.d1_database_id!,
    `SELECT key, name, kind, cadence, verified_at, last_import_at, records_through FROM sources`
  );
  const sourceLines = sources
    .map((s) => `- ${s.name} (${s.key}, ${s.kind}): ${sourceFreshness(s)} state, records through ${s.records_through ?? 'unknown'}`)
    .join('\n');

  const lastUser = body.data.messages.filter((m) => m.role === 'user').pop()?.content ?? '';
  const pattern = `%${lastUser.slice(0, 60).replace(/[%_]/g, '')}%`;
  const { results: articles } = await c.env.CONTROL_DB.prepare(
    `SELECT title, body_md FROM help_articles WHERE published = 1 AND (title LIKE ? OR body_md LIKE ? OR tags LIKE ?) LIMIT 3`
  )
    .bind(pattern, pattern, pattern)
    .all<{ title: string; body_md: string }>();
  const helpContext = articles.map((a) => `## ${a.title}\n${a.body_md.slice(0, 1500)}`).join('\n\n');

  const labels = tenant.funnel_labels_json
    ? (JSON.parse(tenant.funnel_labels_json) as Record<string, string>)
    : { lead: 'Leads', scheduled: 'Scheduled', completed: 'Completed', purchase: 'Purchases' };

  const system = [
    `You are the in dashboard assistant for ${tenant.name}, a marketing attribution dashboard by LetLois.`,
    `The user's role is ${session.role}. Viewers are read only: never offer to change configuration for a viewer; explain instead.`,
    `Funnel stage labels for this tenant: lead = ${labels.lead}, scheduled = ${labels.scheduled}, completed = ${labels.completed}, purchase = ${labels.purchase}.`,
    `The user is currently on the ${body.data.currentTab ?? 'performance'} tab.`,
    `Data sources and freshness:\n${sourceLines || 'none configured yet'}`,
    `Answer usage questions plainly and recommend configuration when asked. When a change is needed and you have a tool for it, call the tool; the user will see a preview and confirm before anything applies. Never claim a change is done until the user confirms it.`,
    `Style rules: never use em dashes. Use periods, commas, or colons instead.`,
    helpContext ? `Relevant help articles:\n${helpContext}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  const tools = toolsForSession(session.role, codeMode);

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1500,
      thinking: { type: 'adaptive' },
      system,
      messages: body.data.messages,
      ...(tools.length > 0 ? { tools } : {}),
    });

    let text = '';
    const proposals: Array<{ id: string; name: string; input: Record<string, unknown>; before: unknown }> = [];
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
      if (block.type === 'tool_use' && canUseTool(session.role, block.name, codeMode)) {
        const tool = TOOLS[block.name]!;
        let before: unknown = null;
        try {
          before = await tool.before(c.env, tenant, block.input as Record<string, unknown>);
        } catch {
          before = null;
        }
        proposals.push({ id: block.id, name: block.name, input: block.input as Record<string, unknown>, before });
      }
    }
    return c.json({ text, proposals, stopReason: response.stop_reason });
  } catch (err) {
    console.error('assistant call failed', err instanceof Error ? err.message : err);
    return c.json({ error: 'the assistant is unavailable right now' }, 502);
  }
});

const executeSchema = z
  .object({
    toolName: z.string().min(1).max(60),
    input: z.record(z.string(), z.unknown()),
    codeMode: z.boolean().default(false),
  })
  .strict();

// Executes a confirmed tool call. The server re checks the role here
// regardless of what the model or client requested.
chatRoutes.post('/execute', async (c) => {
  const session = c.get('session')!;
  const tenant = c.get('tenant')!;
  const body = executeSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);

  const codeMode = body.data.codeMode && session.role === 'agency_admin';
  if (!canUseTool(session.role, body.data.toolName, codeMode)) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const tool = TOOLS[body.data.toolName]!;
  try {
    const before = await tool.before(c.env, tenant, body.data.input);
    const after = await tool.apply(c.env, tenant, body.data.input);
    const logId = await logToolCall(c.env, {
      tenantId: tenant.id,
      userId: session.userId,
      role: session.role,
      toolName: body.data.toolName,
      input: body.data.input,
      result: 'applied',
      before,
      after,
    });
    return c.json({ ok: true, logId, before, after });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'tool failed' }, 422);
  }
});

const revertSchema = z.object({ logId: z.string().min(1).max(40) }).strict();

// One click revert: restores before_json from the audit trail.
chatRoutes.post('/revert', async (c) => {
  const session = c.get('session')!;
  const tenant = c.get('tenant')!;
  const body = revertSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'invalid request' }, 400);

  const log = await c.env.CONTROL_DB.prepare(
    `SELECT * FROM chat_tool_log WHERE id = ? AND tenant_id = ? AND reverted = 0`
  )
    .bind(body.data.logId, tenant.id)
    .first<{ id: string; tool_name: string; input_json: string; user_id: string }>();
  if (!log) return c.json({ error: 'not found or already reverted' }, 404);

  // Revert permission mirrors execute permission.
  const tool = TOOLS[log.tool_name];
  if (!tool || !canUseTool(session.role, log.tool_name, session.role === 'agency_admin')) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const audit = await c.env.CONTROL_DB.prepare(
    `SELECT before_json FROM audit_log WHERE actor_type = 'chat' AND action = ? AND tenant_id = ?
     ORDER BY created_at DESC LIMIT 1`
  )
    .bind(`chat.${log.tool_name}`, tenant.id)
    .first<{ before_json: string | null }>();

  const before = audit?.before_json ? JSON.parse(audit.before_json) : null;
  try {
    await tool.revert(c.env, tenant, before, JSON.parse(log.input_json) as Record<string, unknown>);
    await c.env.CONTROL_DB.prepare(`UPDATE chat_tool_log SET reverted = 1 WHERE id = ?`)
      .bind(log.id)
      .run();
    await logToolCall(c.env, {
      tenantId: tenant.id,
      userId: session.userId,
      role: session.role,
      toolName: log.tool_name,
      input: { revertOf: log.id },
      result: 'reverted',
    });
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'revert failed' }, 422);
  }
});
