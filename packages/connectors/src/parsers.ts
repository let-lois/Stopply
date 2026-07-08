// Parser registry. The seven Be Clinical parsers, generalized so any
// tenant can use any parser. Each parser turns a CSV into canonical
// outputs: ad spend rows, contact leads, stage events, or client records.
// Parsers never special case a provider downstream: everything funnels
// into the same events and stage_events tables.

import { parseCsv, parseCsvRecords, pick } from './csv';
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

export interface AdLineItemRow {
  periodMonth: string;
  channel: string;
  campaign: string;
  adName: string;
  adId: string | null;
  creativeType: string | null;
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

// Stage event from a door-to-door accounts export: the account id IS the
// contact id (the export is the system of record), so no identity
// matching is needed downstream.
export interface D2dStageEventRow {
  contactId: string;
  stage: 'lead' | 'scheduled' | 'completed' | 'purchase';
  occurredAt: string;
}

// Per-rep counters for one month, split by which side of the appointment
// the rep worked: setters knock doors and set appointments, closers sit
// them and close. One rep can appear on both sides.
export interface RepMetricRow {
  periodMonth: string;
  rep: string;
  knocks: number;
  pitches: number;
  appointmentsSet: number;
  sitsSet: number;
  sitsRun: number;
  closes: number;
  installs: number;
}

export interface ParseResult {
  kind: 'ad-spend' | 'ad-line-items' | 'contacts' | 'stage-events' | 'client-records' | 'd2d-accounts';
  adSpend?: AdSpendRow[];
  adLineItems?: AdLineItemRow[];
  contacts?: ContactLeadRow[];
  stageEvents?: StageEventRow[];
  clientRecords?: ClientRecordRow[];
  d2dStageEvents?: D2dStageEventRow[];
  repMetrics?: RepMetricRow[];
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

// 1b. Meta ad level export: one row per ad, with whatever creative type
// column Ads Manager reports (present only when that breakdown column was
// added to the export; otherwise left null for staff to tag).
export const parseMetaAdLineItem: Parser = (text, periodMonth) => {
  const { rows } = parseCsv(text);
  const adLineItems: AdLineItemRow[] = rows
    .map((row) => ({
      periodMonth,
      channel: 'Meta',
      campaign: pick(row, 'campaign name', 'campaign'),
      adName: pick(row, 'ad name', 'ad'),
      adId: pick(row, 'ad id', 'adid') || null,
      creativeType: pick(row, 'creative type', 'ad format', 'asset type') || null,
      spend: parseMoney(pick(row, 'amount spent (usd)', 'amount spent', 'spend')),
      leadsReported: pick(row, 'results', 'leads') ? parseCount(pick(row, 'results', 'leads')) : null,
    }))
    .filter((r) => r.campaign && r.adName);
  return { kind: 'ad-line-items', adLineItems, rowCount: rows.length, recordsFrom: null, recordsThrough: null };
};

// 2b. Google ad level export ("Ads" report): one row per ad, with the
// platform's own ad type as the creative type (e.g. "Responsive search
// ad", "Image ad").
export const parseGoogleAdLineItem: Parser = (text, periodMonth) => {
  const { rows } = parseCsv(text);
  const adLineItems: AdLineItemRow[] = rows
    .filter((row) => {
      const campaign = pick(row, 'campaign');
      return campaign && !/^total/i.test(campaign);
    })
    .map((row) => ({
      periodMonth,
      channel: 'Google',
      campaign: pick(row, 'campaign'),
      adName: pick(row, 'ad', 'headline', 'ad name'),
      adId: pick(row, 'ad id', 'id') || null,
      creativeType: pick(row, 'ad type', 'type') || null,
      spend: parseMoney(pick(row, 'cost', 'spend')),
      leadsReported: pick(row, 'conversions', 'leads')
        ? parseCount(pick(row, 'conversions', 'leads'))
        : null,
    }))
    .filter((r) => r.adName);
  return { kind: 'ad-line-items', adLineItems, rowCount: rows.length, recordsFrom: null, recordsThrough: null };
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

// 10. Door-to-door accounts export (Rogue Solar's knocking CRM): one row
// per account with a timestamp column per funnel stage (Knock, Pitch,
// Appointment, Sit, Closed, Installed) plus setter (owner) and closer
// attribution. Two channels fall out of it: accounts with a Knock
// timestamp are Door to Door; the rest were dispatched from a dialer.
// The export's header row contains BOTH "Appointment" and "Appointment "
// (trailing space, a stage and a disposition, nearly disjoint), so this
// parser reads raw records and unions duplicate columns instead of using
// the dict rows, which would silently drop one of them.
export const parseD2dAccounts: Parser = (text, periodMonth) => {
  const { headers, records } = parseCsvRecords(text);
  const norm = (h: string) => h.trim().toLowerCase();
  const colsFor = (name: string): number[] =>
    headers.map((h, i) => (norm(h) === name ? i : -1)).filter((i) => i >= 0);
  const col = (name: string): number => colsFor(name)[0] ?? -1;

  const cols = {
    accountId: col('accountid'),
    owner: col('owner.name'),
    closer: col('closer.name'),
    firstName: col('resident.firstname'),
    lastName: col('resident.lastname'),
    email: col('resident.email'),
    phone: col('resident.phone'),
    created: col('createddate'),
    source: col('source'),
    stage: col('workflowstage'),
    knock: col('knock'),
    pitch: col('pitch'),
    appointment: colsFor('appointment'),
    sit: col('sit'),
    closed: col('closed'),
    installed: col('installed'),
  };

  const at = (rec: string[], i: number): string => (i >= 0 ? (rec[i] ?? '').trim() : '');
  // Earliest non-empty timestamp among duplicate columns.
  const earliest = (rec: string[], idxs: number[]): string | null => {
    const vals = idxs.map((i) => toIso(at(rec, i))).filter((v): v is string => !!v);
    return vals.sort()[0] ?? null;
  };

  const contacts: ContactLeadRow[] = [];
  const d2dStageEvents: D2dStageEventRow[] = [];
  const reps = new Map<string, RepMetricRow>();
  const inMonthDates: string[] = [];

  const bumpRep = (rep: string, field: keyof Omit<RepMetricRow, 'periodMonth' | 'rep'>) => {
    const key = rep.trim() || 'Unattributed';
    let row = reps.get(key);
    if (!row) {
      row = { periodMonth, rep: key, knocks: 0, pitches: 0, appointmentsSet: 0, sitsSet: 0, sitsRun: 0, closes: 0, installs: 0 };
      reps.set(key, row);
    }
    row[field] += 1;
  };

  for (const rec of records) {
    const accountId = at(rec, cols.accountId);
    if (!accountId) continue;
    const knock = toIso(at(rec, cols.knock));
    const pitch = toIso(at(rec, cols.pitch));
    const appointment = earliest(rec, cols.appointment);
    const sit = toIso(at(rec, cols.sit));
    const closed = toIso(at(rec, cols.closed));
    const installed = toIso(at(rec, cols.installed));
    // Rows with no funnel activity at all (e.g. an imported list marked
    // Does Not Qualify without ever being knocked) are not leads.
    if (!knock && !appointment && !sit && !closed && !installed) continue;

    const created = toIso(at(rec, cols.created));
    // The contact exists from its earliest recorded touch; stage events
    // before the contact's created_at are discarded by the rollup.
    const createdAtEff =
      [created, knock, appointment, sit, closed].filter((v): v is string => !!v).sort()[0] ?? null;
    if (!createdAtEff) continue;
    const leadAt = knock ?? createdAtEff;
    const channel = knock ? 'Door to Door' : 'Dispatch';
    const owner = at(rec, cols.owner);
    const closer = at(rec, cols.closer);
    const firstName = at(rec, cols.firstName);
    const lastName = at(rec, cols.lastName);
    const fullName = `${firstName} ${lastName}`.trim();

    if (monthOf(createdAtEff) === periodMonth) {
      contacts.push({
        externalRef: accountId,
        firstName,
        lastName,
        email: emailNorm(at(rec, cols.email)),
        phoneLast10: phoneLast10(at(rec, cols.phone)),
        nameNorm: nameNorm(fullName),
        createdAt: createdAtEff,
        channel,
        sourceRaw: at(rec, cols.source) || channel,
        campaign: null,
        followupStage: at(rec, cols.stage) || null,
        treatment: null,
        clickId: null,
        utm: { source: null, medium: null, campaign: null, term: null, content: null },
      });
    }

    const pushStage = (stage: D2dStageEventRow['stage'], ts: string | null) => {
      if (ts && monthOf(ts) === periodMonth) {
        d2dStageEvents.push({ contactId: accountId, stage, occurredAt: ts });
        inMonthDates.push(ts);
      }
    };
    pushStage('lead', leadAt);
    pushStage('scheduled', appointment);
    pushStage('completed', sit);
    pushStage('purchase', closed);

    // Rep counters, bucketed by the month each action actually happened.
    const inMonth = (ts: string | null) => !!ts && monthOf(ts) === periodMonth;
    if (inMonth(knock)) bumpRep(owner, 'knocks');
    if (inMonth(pitch)) bumpRep(owner, 'pitches');
    if (inMonth(appointment)) bumpRep(owner, 'appointmentsSet');
    if (inMonth(sit)) {
      bumpRep(owner, 'sitsSet');
      bumpRep(closer, 'sitsRun');
    }
    if (inMonth(closed)) bumpRep(closer, 'closes');
    if (inMonth(installed)) bumpRep(closer, 'installs');
  }

  const range = dateRange(inMonthDates);
  return {
    kind: 'd2d-accounts',
    contacts,
    d2dStageEvents,
    repMetrics: [...reps.values()],
    rowCount: records.length,
    recordsFrom: range.from,
    recordsThrough: range.through,
  };
};

export const PARSER_REGISTRY: Record<string, Parser> = {
  'meta-campaign': parseMetaCampaign,
  'google-campaign': parseGoogleCampaign,
  'meta-ad-lineitem': parseMetaAdLineItem,
  'google-ad-lineitem': parseGoogleAdLineItem,
  'ghl-contacts': parseGhlContacts,
  'ghl-website': parseGhlWebsite,
  'blvd-appointments': parseBlvdAppointments,
  'blvd-line-items': parseBlvdLineItems,
  'blvd-clients': parseBlvdClients,
  'd2d-accounts': parseD2dAccounts,
};
