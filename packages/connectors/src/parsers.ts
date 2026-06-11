// Parser registry. The seven Be Clinical parsers, generalized so any
// tenant can use any parser. Each parser turns a CSV into canonical
// outputs: ad spend rows, contact leads, stage events, or client records.
// Parsers never special case a provider downstream: everything funnels
// into the same events and stage_events tables.

import { parseCsv, pick } from './csv';
import {
  deriveChannel,
  emailNorm,
  monthOf,
  nameNorm,
  parseCount,
  parseMoney,
  phoneLast10,
  readClickId,
  toIso,
} from '@letlois/attribution';

export interface AdSpendRow {
  periodMonth: string;
  channel: string;
  campaign: string;
  spend: number;
  leadsReported: number | null;
}

export interface ContactLeadRow {
  externalRef: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phoneLast10: string | null;
  nameNorm: string | null;
  createdAt: string;
  channel: string;
  sourceRaw: string | null;
  campaign: string | null;
  followupStage: string | null;
  treatment: string | null;
  clickId: string | null;
  utm: Record<string, string | null>;
}

export interface StageEventRow {
  externalRef: string;
  stage: 'lead' | 'scheduled' | 'completed' | 'purchase';
  occurredAt: string;
  amount: number | null;
  // Identity hints used by the rollup engine to match a contact.
  clientId?: string | null;
  email?: string | null;
  phoneLast10?: string | null;
  nameNorm?: string | null;
}

export interface ClientRecordRow {
  clientId: string;
  email: string | null;
  phoneLast10: string | null;
  nameNorm: string | null;
}

export interface ParseResult {
  kind: 'ad-spend' | 'contacts' | 'stage-events' | 'client-records';
  adSpend?: AdSpendRow[];
  contacts?: ContactLeadRow[];
  stageEvents?: StageEventRow[];
  clientRecords?: ClientRecordRow[];
  rowCount: number;
  recordsFrom: string | null;
  recordsThrough: string | null;
}

export type Parser = (csvText: string, periodMonth: string) => ParseResult;

function dateRange(dates: Array<string | null>): { from: string | null; through: string | null } {
  const valid = dates.filter((d): d is string => !!d).sort();
  return { from: valid[0] ?? null, through: valid[valid.length - 1] ?? null };
}

// 1. Meta campaign export: campaign level spend and reported leads.
export const parseMetaCampaign: Parser = (text, periodMonth) => {
  const { rows } = parseCsv(text);
  const adSpend: AdSpendRow[] = rows
    .map((row) => ({
      periodMonth,
      channel: 'Meta',
      campaign: pick(row, 'campaign name', 'campaign'),
      spend: parseMoney(pick(row, 'amount spent (usd)', 'amount spent', 'spend')),
      leadsReported: pick(row, 'results', 'leads') ? parseCount(pick(row, 'results', 'leads')) : null,
    }))
    .filter((r) => r.campaign);
  return { kind: 'ad-spend', adSpend, rowCount: rows.length, recordsFrom: null, recordsThrough: null };
};

// 2. Google campaign export: same shape, Google headers.
export const parseGoogleCampaign: Parser = (text, periodMonth) => {
  const { rows } = parseCsv(text);
  const adSpend: AdSpendRow[] = rows
    .filter((row) => {
      const campaign = pick(row, 'campaign');
      return campaign && !/^total/i.test(campaign);
    })
    .map((row) => ({
      periodMonth,
      channel: 'Google',
      campaign: pick(row, 'campaign'),
      spend: parseMoney(pick(row, 'cost', 'spend')),
      leadsReported: pick(row, 'conversions', 'leads')
        ? parseCount(pick(row, 'conversions', 'leads'))
        : null,
    }));
  return { kind: 'ad-spend', adSpend, rowCount: rows.length, recordsFrom: null, recordsThrough: null };
};

function ghlRowToContact(row: Record<string, string>): ContactLeadRow | null {
  const created = toIso(pick(row, 'created', 'date created', 'created on', 'date added'));
  if (!created) return null;
  const firstName = pick(row, 'first name');
  const lastName = pick(row, 'last name');
  const fullName = `${firstName} ${lastName}`.trim() || pick(row, 'name', 'contact name');
  const utm = {
    source: pick(row, 'utm_source', 'utm source') || null,
    medium: pick(row, 'utm_medium', 'utm medium') || null,
    campaign: pick(row, 'utm_campaign', 'utm campaign') || null,
    term: pick(row, 'utm_term', 'utm term') || null,
    content: pick(row, 'utm_content', 'utm content') || null,
  };
  const clickId = readClickId(row);
  const siteSource = pick(row, 'site source name', 'site_source_name');
  const campaign = pick(row, 'campaign name', 'campaign') || null;
  const channel = deriveChannel({
    utmSource: utm.source,
    siteSourceName: siteSource || null,
    campaignName: campaign,
    tags: pick(row, 'tags') || null,
    gclid: clickId,
    fbclid: pick(row, 'fbclid') || null,
  });
  return {
    externalRef: pick(row, 'contact id', 'contactid', 'id') || `ghl:${emailNorm(pick(row, 'email')) ?? fullName}:${created}`,
    firstName,
    lastName,
    email: emailNorm(pick(row, 'email')),
    phoneLast10: phoneLast10(pick(row, 'phone')),
    nameNorm: nameNorm(fullName),
    createdAt: created,
    channel,
    sourceRaw: utm.source ?? siteSource ?? null,
    campaign,
    followupStage: pick(row, 'followup stage', 'follow up stage', 'stage') || null,
    treatment: pick(row, 'treatment of interest', 'treatment') || null,
    clickId,
    utm,
  };
}

// 3. GHL contacts full export.
export const parseGhlContacts: Parser = (text, periodMonth) => {
  const { rows } = parseCsv(text);
  const contacts = rows
    .map(ghlRowToContact)
    .filter((c): c is ContactLeadRow => c !== null && monthOf(c.createdAt) === periodMonth);
  const range = dateRange(contacts.map((c) => c.createdAt));
  return {
    kind: 'contacts',
    contacts,
    rowCount: rows.length,
    recordsFrom: range.from,
    recordsThrough: range.through,
  };
};

// 4. GHL website filtered export: same shape, all rows count as Website
// when nothing stronger identifies the channel.
export const parseGhlWebsite: Parser = (text, periodMonth) => {
  const { rows } = parseCsv(text);
  const contacts = rows
    .map((row) => {
      const c = ghlRowToContact(row);
      if (!c) return null;
      if (c.channel === 'Unknown') c.channel = 'Website';
      return c;
    })
    .filter((c): c is ContactLeadRow => c !== null && monthOf(c.createdAt) === periodMonth);
  const range = dateRange(contacts.map((c) => c.createdAt));
  return {
    kind: 'contacts',
    contacts,
    rowCount: rows.length,
    recordsFrom: range.from,
    recordsThrough: range.through,
  };
};

// 5. Boulevard appointments: booked, confirmed, and arrived map to
// scheduled; final states map to completed. Appointment Client Id equals
// ClientRecord id (the identity bridge).
export const parseBlvdAppointments: Parser = (text, periodMonth) => {
  const { rows } = parseCsv(text);
  const stageEvents: StageEventRow[] = [];
  for (const row of rows) {
    const at = toIso(pick(row, 'start at', 'start time', 'appointment date', 'date'));
    if (!at || monthOf(at) !== periodMonth) continue;
    const state = pick(row, 'state', 'status').toLowerCase();
    const clientId = pick(row, 'client id', 'clientid') || null;
    const apptId = pick(row, 'appointment id', 'id') || `${clientId}:${at}`;
    const name = nameNorm(pick(row, 'client name', 'client'));
    if (/booked|confirmed|arrived|final/.test(state)) {
      stageEvents.push({
        externalRef: `blvd-appt:${apptId}`,
        stage: 'scheduled',
        occurredAt: at,
        amount: null,
        clientId,
        nameNorm: name,
      });
    }
    if (/final/.test(state)) {
      stageEvents.push({
        externalRef: `blvd-appt-completed:${apptId}`,
        stage: 'completed',
        occurredAt: at,
        amount: null,
        clientId,
        nameNorm: name,
      });
    }
  }
  const range = dateRange(stageEvents.map((e) => e.occurredAt));
  return {
    kind: 'stage-events',
    stageEvents,
    rowCount: rows.length,
    recordsFrom: range.from,
    recordsThrough: range.through,
  };
};

// 6. Boulevard detailed line items: purchase stage events with amounts.
// Line items join to contacts by normalized name only, matching the Be
// Clinical field semantics exactly.
export const parseBlvdLineItems: Parser = (text, periodMonth) => {
  const { rows } = parseCsv(text);
  const stageEvents: StageEventRow[] = [];
  for (const row of rows) {
    const at = toIso(pick(row, 'sale date', 'closed at', 'date'));
    if (!at || monthOf(at) !== periodMonth) continue;
    const amount = parseMoney(pick(row, 'net sales', 'line item total', 'amount', 'total'));
    const name = nameNorm(pick(row, 'client name', 'client'));
    const lineId = pick(row, 'line item id', 'sale id', 'id') || `${name}:${at}:${amount}`;
    stageEvents.push({
      externalRef: `blvd-line:${lineId}`,
      stage: 'purchase',
      occurredAt: at,
      amount,
      nameNorm: name,
    });
  }
  const range = dateRange(stageEvents.map((e) => e.occurredAt));
  return {
    kind: 'stage-events',
    stageEvents,
    rowCount: rows.length,
    recordsFrom: range.from,
    recordsThrough: range.through,
  };
};

// 7. Boulevard client records: the identity bridge between appointment
// Client Ids and contact identities.
export const parseBlvdClients: Parser = (text) => {
  const { rows } = parseCsv(text);
  const clientRecords: ClientRecordRow[] = rows
    .map((row) => {
      const clientId = pick(row, 'id', 'client id');
      if (!clientId) return null;
      const first = pick(row, 'first name');
      const last = pick(row, 'last name');
      const full = `${first} ${last}`.trim() || pick(row, 'name', 'client name');
      return {
        clientId,
        email: emailNorm(pick(row, 'email')),
        phoneLast10: phoneLast10(pick(row, 'mobile phone', 'phone')),
        nameNorm: nameNorm(full),
      };
    })
    .filter((r): r is ClientRecordRow => r !== null);
  return {
    kind: 'client-records',
    clientRecords,
    rowCount: rows.length,
    recordsFrom: null,
    recordsThrough: null,
  };
};

export const PARSER_REGISTRY: Record<string, Parser> = {
  'meta-campaign': parseMetaCampaign,
  'google-campaign': parseGoogleCampaign,
  'ghl-contacts': parseGhlContacts,
  'ghl-website': parseGhlWebsite,
  'blvd-appointments': parseBlvdAppointments,
  'blvd-line-items': parseBlvdLineItems,
  'blvd-clients': parseBlvdClients,
};
