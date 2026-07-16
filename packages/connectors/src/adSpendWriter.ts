// Shared writer for connectors that produce ad-spend/ad-line-item rows
// (currently just Meta) instead of CRM stage events. Same replace-then-
// insert semantics as applyParseResult's CSV-import path: a synced month
// wholesale replaces that month+channel's existing rows.

import type { ConnectorDb } from './types';
import type { AdSpendRow, AdLineItemRow } from './parsers';

export async function writeAdSpendRows(db: ConnectorDb, month: string, rows: AdSpendRow[]): Promise<void> {
  const channels = [...new Set(rows.map((r) => r.channel))];
  const statements = [
    ...channels.map((channel) => ({
      sql: `DELETE FROM raw_ad_spend WHERE period_month = ? AND channel = ?`,
      params: [month, channel],
    })),
    ...rows.map((row) => ({
      sql: `INSERT INTO raw_ad_spend (period_month, channel, campaign, spend, leads_reported)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (period_month, channel, campaign) DO UPDATE SET
              spend = excluded.spend, leads_reported = excluded.leads_reported`,
      params: [row.periodMonth, row.channel, row.campaign, row.spend, row.leadsReported],
    })),
  ];
  if (statements.length) await db.batch(statements);
}

export async function writeAdLineItemRows(db: ConnectorDb, month: string, rows: AdLineItemRow[]): Promise<void> {
  const channels = [...new Set(rows.map((r) => r.channel))];
  const statements = [
    ...channels.map((channel) => ({
      sql: `DELETE FROM ad_line_items WHERE period_month = ? AND channel = ?`,
      params: [month, channel],
    })),
    ...rows.map((row) => ({
      sql: `INSERT INTO ad_line_items (period_month, channel, campaign, ad_name, ad_id, creative_type, creative_type_source, spend, leads_reported)
            VALUES (?, ?, ?, ?, ?, ?, 'auto', ?, ?)
            ON CONFLICT (period_month, channel, campaign, ad_name) DO UPDATE SET
              ad_id = excluded.ad_id, creative_type = excluded.creative_type, creative_type_source = 'auto',
              spend = excluded.spend, leads_reported = excluded.leads_reported`,
      params: [row.periodMonth, row.channel, row.campaign, row.adName, row.adId, row.creativeType, row.spend, row.leadsReported],
    })),
  ];
  if (statements.length) await db.batch(statements);
}
