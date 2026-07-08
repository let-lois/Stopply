import { describe, it, expect } from 'vitest';
import {
  PARSER_REGISTRY,
  parseBlvdAppointments,
  parseBlvdClients,
  parseBlvdLineItems,
  parseGhlContacts,
  parseGoogleAdLineItem,
  parseGoogleCampaign,
  parseMetaAdLineItem,
  parseMetaCampaign,
} from '../src/parsers';

describe('parser registry', () => {
  it('exposes every registered parser', () => {
    expect(Object.keys(PARSER_REGISTRY).sort()).toEqual([
      'blvd-appointments',
      'blvd-clients',
      'blvd-line-items',
      'd2d-accounts',
      'ghl-contacts',
      'ghl-website',
      'google-ad-lineitem',
      'google-campaign',
      'meta-ad-lineitem',
      'meta-campaign',
    ]);
  });
});

describe('meta campaign parser', () => {
  it('parses spend as numbers and keeps campaign names', () => {
    const csv = 'Campaign name,Amount spent (USD),Results\nSpring Promo,"1,234.56",42\nBrand,"987.10",18\n';
    const out = parseMetaCampaign(csv, '2026-05');
    expect(out.adSpend).toHaveLength(2);
    expect(out.adSpend![0]).toMatchObject({ channel: 'Meta', campaign: 'Spring Promo', spend: 1234.56, leadsReported: 42 });
  });
});

describe('google campaign parser', () => {
  it('skips total rows and parses cost', () => {
    const csv = 'Campaign,Cost,Conversions\nBrand Search,"2,000.00",30\nTotal: Account,"2,000.00",30\n';
    const out = parseGoogleCampaign(csv, '2026-05');
    expect(out.adSpend).toHaveLength(1);
    expect(out.adSpend![0]).toMatchObject({ channel: 'Google', campaign: 'Brand Search', spend: 2000 });
  });
});

describe('meta ad line item parser', () => {
  it('parses one row per ad, keeping campaign and creative type', () => {
    const csv = [
      'Campaign name,Ad set name,Ad name,Ad ID,Creative type,Amount spent (USD),Results',
      'Filler Intro — June,Filler Intro,Before / After — Filler,120001,Carousel,"2,450.00",31',
      'Filler Intro — June,Filler Intro,Patient Story — Laser,120002,,"1,900.00",14',
    ].join('\n');
    const out = parseMetaAdLineItem(csv, '2026-06');
    expect(out.kind).toBe('ad-line-items');
    expect(out.adLineItems).toHaveLength(2);
    expect(out.adLineItems![0]).toMatchObject({
      channel: 'Meta',
      campaign: 'Filler Intro — June',
      adName: 'Before / After — Filler',
      adId: '120001',
      creativeType: 'Carousel',
      spend: 2450,
      leadsReported: 31,
    });
    // No creative type column value: left null for staff to tag, not
    // defaulted to something misleading.
    expect(out.adLineItems![1]!.creativeType).toBeNull();
  });

  it('drops rows missing a campaign or ad name', () => {
    const csv = 'Campaign name,Ad name,Amount spent (USD),Results\n,Orphan ad,"10.00",1\n';
    const out = parseMetaAdLineItem(csv, '2026-06');
    expect(out.adLineItems).toHaveLength(0);
  });
});

describe('google ad line item parser', () => {
  it('parses one row per ad and skips total rows', () => {
    const csv = [
      'Campaign,Ad,Ad type,Cost,Conversions',
      'Brand Search,Book a consult today,Responsive search ad,"1,200.00",22',
      'Total: Account,,,"1,200.00",22',
    ].join('\n');
    const out = parseGoogleAdLineItem(csv, '2026-06');
    expect(out.adLineItems).toHaveLength(1);
    expect(out.adLineItems![0]).toMatchObject({
      channel: 'Google',
      campaign: 'Brand Search',
      adName: 'Book a consult today',
      creativeType: 'Responsive search ad',
      spend: 1200,
      leadsReported: 22,
    });
  });
});

describe('ghl contacts parser', () => {
  const csv = [
    'Contact Id,First Name,Last Name,Email,Phone,Created,Followup Stage,Treatment of Interest,Tags,utm_source,site source name,campaign name,clickld',
    'c1,Jane,Doe,jane@x.com,(602) 555-0101,5/03/2026 2:15 pm,Booked,Botox,,google,,Spring,abc123',
    'c2,Bob,Ray,bob@x.com,602-555-0102,5/10/2026,New,Filler,facebook lead,,,Retarget,',
    'c3,Old,Lead,old@x.com,602-555-0103,4/22/2026,New,,,,,,',
  ].join('\n');

  it('filters to the period month and derives channels', () => {
    const out = parseGhlContacts(csv, '2026-05');
    expect(out.contacts).toHaveLength(2);
    const [jane, bob] = out.contacts!;
    expect(jane!.channel).toBe('Google');
    expect(jane!.clickId).toBe('abc123');
    expect(jane!.phoneLast10).toBe('6025550101');
    expect(jane!.createdAt).toBe('2026-05-03T14:15:00.000Z');
    // Empty utm fields fall through to the Tags fallback.
    expect(bob!.channel).toBe('Meta');
    expect(out.recordsFrom).toBe('2026-05-03T14:15:00.000Z');
    expect(out.recordsThrough).toBe('2026-05-10T00:00:00.000Z');
  });
});

describe('boulevard appointments parser', () => {
  const csv = [
    'Appointment Id,Client Id,Client Name,Start At,State',
    'a1,cl1,Jane Doe,5/05/2026 10:00 am,final',
    'a2,cl2,Bob Ray,5/06/2026 11:00 am,booked',
    'a3,cl3,Sky Lee,5/07/2026 12:00 pm,cancelled',
  ].join('\n');

  it('maps booked to scheduled and final to scheduled plus completed', () => {
    const out = parseBlvdAppointments(csv, '2026-05');
    const stages = out.stageEvents!.map((e) => e.stage).sort();
    expect(stages).toEqual(['completed', 'scheduled', 'scheduled']);
    const completed = out.stageEvents!.find((e) => e.stage === 'completed')!;
    expect(completed.clientId).toBe('cl1');
  });
});

describe('boulevard line items parser', () => {
  it('produces purchase events with parsed amounts joined by normalized name', () => {
    const csv = 'Line Item Id,Client Name,Sale Date,Net Sales\nli1,"Doe, Jane",5/05/2026,"$1,500.00"\n';
    const out = parseBlvdLineItems(csv, '2026-05');
    expect(out.stageEvents).toHaveLength(1);
    expect(out.stageEvents![0]).toMatchObject({ stage: 'purchase', amount: 1500, nameNorm: 'doe jane' });
  });
});

describe('boulevard clients parser', () => {
  it('builds the identity bridge keyed by client id', () => {
    const csv = 'Id,First Name,Last Name,Email,Mobile Phone\ncl1,Jane,Doe,jane@x.com,602-555-0101\n';
    const out = parseBlvdClients(csv, '2026-05');
    expect(out.clientRecords![0]).toMatchObject({
      clientId: 'cl1',
      email: 'jane@x.com',
      phoneLast10: '6025550101',
      nameNorm: 'doe jane',
    });
  });
});
