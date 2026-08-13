// Seed platform data.
//
// The clients are fictional. The prototype seeded two real LetLois clients
// and attributed fabricated revenue, ROAS and contract values to them, which
// is a liability in any demo that leaves the building. Names, industries and
// contacts here are invented, and every address uses example.invalid, a
// reserved domain that cannot route.

import type { AuditLogEntry, Client, CredentialRef, PlatformUser } from '@/types';

const HOUR = 3600_000;
const DAY = 86_400_000;

function iso(offsetMs: number, now: Date): string {
  return new Date(now.getTime() - offsetMs).toISOString();
}

export function seedClients(now: Date = new Date()): Client[] {
  return [
    {
      id: 'cl_northwind',
      code: 'NWD',
      name: 'Northwind Exteriors',
      industry: 'Home services',
      status: 'active',
      plan: 'Enterprise',
      dataMode: 'demo',
      // Runs a crew and buys ads, so it carries both halves of the platform.
      enabledModules: ['advertising', 'field_sales', 'crm', 'analytics'],
      integrations: [
        { id: 'int_nwd_meta', name: 'Meta Ads', provider: 'meta', connected: true, dataMode: 'demo', lastSynced: iso(2 * HOUR, now), accountName: 'Northwind Exteriors' },
        { id: 'int_nwd_google', name: 'Google Ads', provider: 'google_ads', connected: true, dataMode: 'demo', lastSynced: iso(3 * HOUR, now) },
        { id: 'int_nwd_maps', name: 'Field Maps', provider: 'field_maps', connected: false, dataMode: 'demo' },
      ],
      createdAt: iso(420 * DAY, now),
      lastActive: iso(2 * HOUR, now),
      contactEmail: 'ops@northwind.example.invalid',
      contactName: 'Dana Whitfield',
    },
    {
      id: 'cl_harbourline',
      code: 'HBL',
      name: 'Harbourline Supply',
      industry: 'Ecommerce',
      status: 'active',
      plan: 'Pro',
      dataMode: 'demo',
      enabledModules: ['ecommerce', 'logistics', 'analytics'],
      integrations: [
        { id: 'int_hbl_shopify', name: 'Shopify', provider: 'shopify', connected: true, dataMode: 'demo', lastSynced: iso(40 * 60_000, now), accountName: 'harbourline-supply' },
        { id: 'int_hbl_stripe', name: 'Stripe', provider: 'stripe', connected: true, dataMode: 'demo', lastSynced: iso(35 * 60_000, now) },
        { id: 'int_hbl_carrier', name: 'Carrier API', provider: 'carrier_api', connected: true, dataMode: 'demo', lastSynced: iso(6 * HOUR, now) },
      ],
      createdAt: iso(260 * DAY, now),
      lastActive: iso(25 * 60_000, now),
      contactEmail: 'hello@harbourline.example.invalid',
      contactName: 'Priya Ramanathan',
    },
    {
      id: 'cl_kestrel',
      code: 'KST',
      name: 'Kestrel Roofing Co',
      industry: 'Roofing',
      status: 'active',
      plan: 'Pro',
      dataMode: 'demo',
      // Door to door only. No ad accounts, so no advertising section: an
      // empty Meta tab and a spend KPI of zero describe a business that is
      // not theirs.
      enabledModules: ['field_sales', 'crm'],
      integrations: [
        { id: 'int_kst_maps', name: 'Field Maps', provider: 'field_maps', connected: true, dataMode: 'demo', lastSynced: iso(50 * 60_000, now) },
      ],
      createdAt: iso(95 * DAY, now),
      lastActive: iso(50 * 60_000, now),
      contactEmail: 'field@kestrelroofing.example.invalid',
      contactName: 'Marcus Bell',
    },
    {
      id: 'cl_aldergrove',
      code: 'ALD',
      name: 'Aldergrove Wellness',
      industry: 'Med spa',
      status: 'onboarding',
      plan: 'Growth',
      dataMode: 'demo',
      enabledModules: ['advertising', 'crm'],
      integrations: [
        { id: 'int_ald_meta', name: 'Meta Ads', provider: 'meta', connected: true, dataMode: 'demo', lastSynced: iso(9 * HOUR, now) },
      ],
      createdAt: iso(12 * DAY, now),
      lastActive: iso(4 * HOUR, now),
      contactEmail: 'team@aldergrove.example.invalid',
      contactName: 'Rowan Alexander',
    },
  ];
}

export function seedUsers(): PlatformUser[] {
  return [
    { id: 'usr_alex', name: 'Alex Rivera', email: 'alex@stopply.example.invalid', role: 'super_admin', clientId: null, status: 'active' },
    { id: 'usr_dana', name: 'Dana Whitfield', email: 'dana@northwind.example.invalid', role: 'client_admin', clientId: 'cl_northwind', clientName: 'Northwind Exteriors', status: 'active' },
    { id: 'usr_marcus', name: 'Marcus Bell', email: 'marcus@kestrelroofing.example.invalid', role: 'manager', clientId: 'cl_kestrel', clientName: 'Kestrel Roofing Co', status: 'active' },
    { id: 'usr_riley', name: 'Riley Osei', email: 'riley@kestrelroofing.example.invalid', role: 'representative', clientId: 'cl_kestrel', clientName: 'Kestrel Roofing Co', status: 'active' },
    { id: 'usr_priya', name: 'Priya Ramanathan', email: 'priya@harbourline.example.invalid', role: 'client_admin', clientId: 'cl_harbourline', clientName: 'Harbourline Supply', status: 'invited' },
  ];
}

export function seedAuditLog(now: Date = new Date()): AuditLogEntry[] {
  return [
    { id: 'aud_1', timestamp: iso(2 * HOUR, now), userId: 'usr_alex', userName: 'Alex Rivera', clientId: 'cl_kestrel', clientName: 'Kestrel Roofing Co', moduleId: 'field_sales', action: 'ENABLE_MODULE', details: 'Enabled Field Sales' },
    { id: 'aud_2', timestamp: iso(6 * HOUR, now), userId: 'usr_alex', userName: 'Alex Rivera', clientId: 'cl_aldergrove', clientName: 'Aldergrove Wellness', action: 'CREATE_CLIENT', details: 'Created workspace Aldergrove Wellness' },
    { id: 'aud_3', timestamp: iso(28 * HOUR, now), userId: 'usr_dana', userName: 'Dana Whitfield', clientId: 'cl_northwind', clientName: 'Northwind Exteriors', moduleId: 'advertising', action: 'SWITCH_DATA_MODE', details: 'Advertising data mode set to demo' },
  ];
}

// References only. There is no code path in this application that accepts,
// stores, transmits or displays a credential value.
export function seedCredentialRefs(now: Date = new Date()): CredentialRef[] {
  return [
    { id: 'cred_1', clientId: 'cl_northwind', clientName: 'Northwind Exteriors', provider: 'Meta', keyName: 'Long-lived access token', last4: '8f2a', updatedAt: iso(30 * DAY, now), status: 'active' },
    { id: 'cred_2', clientId: 'cl_harbourline', clientName: 'Harbourline Supply', provider: 'Shopify', keyName: 'Admin API key', last4: '41cd', updatedAt: iso(64 * DAY, now), status: 'active' },
    { id: 'cred_3', clientId: 'cl_harbourline', clientName: 'Harbourline Supply', provider: 'Stripe', keyName: 'Restricted key', last4: '9b70', updatedAt: iso(120 * DAY, now), status: 'expired' },
  ];
}
