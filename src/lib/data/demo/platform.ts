// Seed platform data.
//
// The client names are real LetLois clients, at the owner's explicit
// direction, so the demo reads as their own book of business. Everything
// attached to them here is invented: spend, revenue, orders, deals, knocks,
// all of it generated per client id.
//
// That combination is the thing to be careful with. Contact names and
// addresses stay fictional and use example.invalid, a reserved domain that
// cannot route, so no demo row can reach a real person. The header carries a
// standing "Demo data" badge for the same reason.

import type { AuditLogEntry, Client, CredentialRef, PlatformUser } from '@/types';

const HOUR = 3600_000;
const DAY = 86_400_000;

function iso(offsetMs: number, now: Date): string {
  return new Date(now.getTime() - offsetMs).toISOString();
}

export function seedClients(now: Date = new Date()): Client[] {
  return [
    {
      id: 'cl_bluecactus',
      code: 'BCP',
      name: 'Blue Cactus Power Washing',
      industry: 'Exterior cleaning',
      status: 'active',
      plan: 'Pro',
      dataMode: 'demo',
      enabledModules: ['advertising', 'crm', 'analytics'],
      integrations: [
        { id: 'int_bcp_meta', name: 'Meta Ads', provider: 'meta', connected: true, dataMode: 'demo', lastSynced: iso(2 * HOUR, now), accountName: 'Blue Cactus' },
        { id: 'int_bcp_google', name: 'Google Ads', provider: 'google_ads', connected: true, dataMode: 'demo', lastSynced: iso(3 * HOUR, now) },
      ],
      createdAt: iso(420 * DAY, now),
      lastActive: iso(40 * 60_000, now),
      contactEmail: 'ops@bluecactus.example.invalid',
      contactName: 'Dana Whitfield',
      timezone: 'America/Phoenix',
    },
    {
      id: 'cl_allstar',
      code: 'ALL',
      name: 'Allstar Home Solutions',
      industry: 'Home improvement',
      status: 'active',
      plan: 'Pro',
      dataMode: 'demo',
      // Door to door, no ad accounts. Showing this client an empty Meta
      // section and a spend KPI of zero would describe a business that is
      // not theirs.
      enabledModules: ['field_sales', 'crm'],
      integrations: [
        { id: 'int_all_maps', name: 'Field Maps', provider: 'field_maps', connected: true, dataMode: 'demo', lastSynced: iso(50 * 60_000, now) },
      ],
      createdAt: iso(95 * DAY, now),
      lastActive: iso(20 * 60_000, now),
      contactEmail: 'field@allstar.example.invalid',
      contactName: 'Marcus Bell',
      timezone: 'America/Phoenix',
    },
    {
      id: 'cl_beclinical',
      code: 'BEC',
      name: 'BeClinical',
      industry: 'Med spa',
      status: 'active',
      plan: 'Enterprise',
      dataMode: 'demo',
      enabledModules: ['advertising', 'crm', 'analytics'],
      integrations: [
        { id: 'int_bec_meta', name: 'Meta Ads', provider: 'meta', connected: true, dataMode: 'demo', lastSynced: iso(90 * 60_000, now), accountName: 'BeClinical' },
        { id: 'int_bec_google', name: 'Google Ads', provider: 'google_ads', connected: true, dataMode: 'demo', lastSynced: iso(2 * HOUR, now) },
      ],
      createdAt: iso(500 * DAY, now),
      lastActive: iso(3 * HOUR, now),
      contactEmail: 'team@beclinical.example.invalid',
      contactName: 'Priya Ramanathan',
      timezone: 'America/Phoenix',
    },
    {
      id: 'cl_roguesolar',
      code: 'RGS',
      name: 'Rogue Solar',
      industry: 'Solar',
      status: 'active',
      plan: 'Enterprise',
      dataMode: 'demo',
      // Knocks doors and buys ads, so it carries both halves of the platform.
      enabledModules: ['field_sales', 'advertising', 'crm', 'analytics'],
      integrations: [
        { id: 'int_rgs_maps', name: 'Field Maps', provider: 'field_maps', connected: true, dataMode: 'demo', lastSynced: iso(35 * 60_000, now) },
        { id: 'int_rgs_meta', name: 'Meta Ads', provider: 'meta', connected: true, dataMode: 'demo', lastSynced: iso(4 * HOUR, now) },
      ],
      createdAt: iso(260 * DAY, now),
      lastActive: iso(15 * 60_000, now),
      contactEmail: 'ops@roguesolar.example.invalid',
      contactName: 'Rowan Alexander',
      timezone: 'America/Los_Angeles',
    },
  ];
}

// Fictional people. Real company, invented staff: nobody in this list should
// be contactable, and example.invalid guarantees it.
export function seedUsers(): PlatformUser[] {
  return [
    { id: 'usr_alex', name: 'Alex Rivera', email: 'alex@stopply.example.invalid', role: 'super_admin', clientId: null, status: 'active' },
    { id: 'usr_dana', name: 'Dana Whitfield', email: 'dana@bluecactus.example.invalid', role: 'client_admin', clientId: 'cl_bluecactus', clientName: 'Blue Cactus Power Washing', status: 'active' },
    { id: 'usr_marcus', name: 'Marcus Bell', email: 'marcus@allstar.example.invalid', role: 'manager', clientId: 'cl_allstar', clientName: 'Allstar Home Solutions', status: 'active' },
    { id: 'usr_riley', name: 'Riley Osei', email: 'riley@allstar.example.invalid', role: 'representative', clientId: 'cl_allstar', clientName: 'Allstar Home Solutions', status: 'active' },
    { id: 'usr_priya', name: 'Priya Ramanathan', email: 'priya@beclinical.example.invalid', role: 'client_admin', clientId: 'cl_beclinical', clientName: 'BeClinical', status: 'invited' },
  ];
}

export function seedAuditLog(now: Date = new Date()): AuditLogEntry[] {
  return [
    { id: 'aud_1', timestamp: iso(2 * HOUR, now), userId: 'usr_alex', userName: 'Alex Rivera', clientId: 'cl_allstar', clientName: 'Allstar Home Solutions', moduleId: 'field_sales', action: 'ENABLE_MODULE', details: 'Enabled Field Sales' },
    { id: 'aud_2', timestamp: iso(6 * HOUR, now), userId: 'usr_alex', userName: 'Alex Rivera', clientId: 'cl_roguesolar', clientName: 'Rogue Solar', moduleId: 'analytics', action: 'ENABLE_MODULE', details: 'Enabled Analytics' },
    { id: 'aud_3', timestamp: iso(28 * HOUR, now), userId: 'usr_dana', userName: 'Dana Whitfield', clientId: 'cl_bluecactus', clientName: 'Blue Cactus Power Washing', moduleId: 'advertising', action: 'SWITCH_DATA_MODE', details: 'Advertising data mode set to demo' },
  ];
}

// References only. There is no code path in this application that accepts,
// stores, transmits or displays a credential value.
export function seedCredentialRefs(now: Date = new Date()): CredentialRef[] {
  return [
    { id: 'cred_1', clientId: 'cl_bluecactus', clientName: 'Blue Cactus Power Washing', provider: 'Meta', keyName: 'Long-lived access token', last4: '8f2a', updatedAt: iso(30 * DAY, now), status: 'active' },
    { id: 'cred_2', clientId: 'cl_beclinical', clientName: 'BeClinical', provider: 'Google Ads', keyName: 'OAuth refresh token', last4: '41cd', updatedAt: iso(64 * DAY, now), status: 'active' },
    { id: 'cred_3', clientId: 'cl_roguesolar', clientName: 'Rogue Solar', provider: 'Meta', keyName: 'System user token', last4: '9b70', updatedAt: iso(120 * DAY, now), status: 'expired' },
  ];
}
