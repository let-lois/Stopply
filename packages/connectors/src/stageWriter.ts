// Shared writer used by all connectors: stage events land deduped on
// (stage, external_ref) with identity hints in raw_json for the rollup
// matcher, exactly like the CSV import path.

import type { ConnectorDb } from './types';
import { syntheticId } from './types';

export interface ConnectorStageEvent {
  externalRef: string;
  stage: 'lead' | 'scheduled' | 'completed' | 'purchase';
  occurredAt: string;
  amount: number | null;
  clientId?: string | null;
  email?: string | null;
  phoneLast10?: string | null;
  nameNorm?: string | null;
}

export async function writeStageEvents(
  db: ConnectorDb,
  sourceKey: string,
  events: ConnectorStageEvent[]
): Promise<void> {
  const statements = events.map((ev) => ({
    sql: `INSERT OR IGNORE INTO stage_events (id, contact_id, external_ref, stage, occurred_at, amount, source_key, raw_json)
          VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
    params: [
      syntheticId('se'),
      ev.externalRef,
      ev.stage,
      ev.occurredAt,
      ev.amount,
      sourceKey,
      JSON.stringify({
        clientId: ev.clientId ?? null,
        email: ev.email ?? null,
        phoneLast10: ev.phoneLast10 ?? null,
        nameNorm: ev.nameNorm ?? null,
      }),
    ],
  }));
  if (statements.length) await db.batch(statements);
}

export async function writeClientRecords(
  db: ConnectorDb,
  sourceKey: string,
  records: Array<{ clientId: string; email: string | null; phoneLast10: string | null; nameNorm: string | null }>
): Promise<void> {
  const statements = records.map((r) => ({
    sql: `INSERT INTO client_records (client_id, email_norm, phone_last10, name_norm, source_key)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (client_id) DO UPDATE SET email_norm = excluded.email_norm,
            phone_last10 = excluded.phone_last10, name_norm = excluded.name_norm`,
    params: [r.clientId, r.email, r.phoneLast10, r.nameNorm, sourceKey],
  }));
  if (statements.length) await db.batch(statements);
}
