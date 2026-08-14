// Stand-in data for the preview build.
//
// Invented, but shaped exactly like what /api/field returns, and weighted the
// way a real day on the doors goes: most knocks reach nobody, conversations
// are a minority of those, and a sale is rare. A preview that showed a 40%
// close rate would be a lie about the product as well as about the numbers.
//
// Every name, address and phone number here is made up. Nothing real from a
// client's database belongs in something that gets shared around.

import type { Disposition, FieldBootstrap, FieldStats, NearbyAddress, SavedVisit } from '../types';

// The catalog migration 0006 seeds into every tenant, which is what All Star
// is running.
export const DISPOSITIONS: Disposition[] = [
  { key: 'no_answer', label: 'No answer', sortOrder: 1, isContact: false, isLead: false, isAppointment: false, isSale: false, marksDoNotKnock: false, color: '#8b97a8', active: true },
  { key: 'not_interested', label: 'Not interested', sortOrder: 2, isContact: true, isLead: false, isAppointment: false, isSale: false, marksDoNotKnock: false, color: '#c7502f', active: true },
  { key: 'callback', label: 'Come back later', sortOrder: 3, isContact: true, isLead: false, isAppointment: false, isSale: false, marksDoNotKnock: false, color: '#c7902f', active: true },
  { key: 'interested', label: 'Interested', sortOrder: 4, isContact: true, isLead: true, isAppointment: false, isSale: false, marksDoNotKnock: false, color: '#1f7ae0', active: true },
  { key: 'appointment', label: 'Appointment set', sortOrder: 5, isContact: true, isLead: true, isAppointment: true, isSale: false, marksDoNotKnock: false, color: '#6f5ad6', active: true },
  { key: 'sale', label: 'Sold', sortOrder: 6, isContact: true, isLead: true, isAppointment: true, isSale: true, marksDoNotKnock: false, color: '#1f9d6b', active: true },
  { key: 'do_not_knock', label: 'Do not knock', sortOrder: 7, isContact: true, isLead: false, isAppointment: false, isSale: false, marksDoNotKnock: true, color: '#211d16', active: true },
];

export const BOOTSTRAP: FieldBootstrap = {
  rep: { id: 'fr_preview', name: 'Dana Reyes', email: 'dana@allstar.example', role: 'rep', team: 'East Mesa' },
  tenant: { name: 'All Star', slug: 'all-star', timezone: 'America/Phoenix' },
  dispositions: DISPOSITIONS,
  csrf: 'preview',
};

// Times are relative to whenever the preview is opened, so the Today screen
// always reads like the current afternoon rather than a fixed date that goes
// stale the day after this is built.
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

export const VISITS: SavedVisit[] = [
  { id: 'v1', clientUuid: 'u1', addressId: 'a1', address: '1184 E Broadway Rd, Mesa, AZ 85204', street: '1184 E Broadway Rd', unit: null, city: 'Mesa', state: 'AZ', postalCode: '85204', disposition: 'appointment', notes: 'Roof is 18 years old, has the paperwork ready. Wants his wife there.', contactName: 'Marcus Bell', contactPhone: '480-555-0142', contactEmail: null, occurredAt: hoursAgo(1.4), followUpAt: null },
  { id: 'v2', clientUuid: 'u2', addressId: 'a2', address: '1190 E Broadway Rd, Mesa, AZ 85204', street: '1190 E Broadway Rd', unit: null, city: 'Mesa', state: 'AZ', postalCode: '85204', disposition: 'no_answer', notes: null, contactName: null, contactPhone: null, contactEmail: null, occurredAt: hoursAgo(1.7), followUpAt: null },
  { id: 'v3', clientUuid: 'u3', addressId: 'a3', address: '1196 E Broadway Rd, Mesa, AZ 85204', street: '1196 E Broadway Rd', unit: null, city: 'Mesa', state: 'AZ', postalCode: '85204', disposition: 'not_interested', notes: 'Just had it done last spring.', contactName: null, contactPhone: null, contactEmail: null, occurredAt: hoursAgo(2.1), followUpAt: null },
  { id: 'v4', clientUuid: 'u4', addressId: 'a4', address: '1202 E Broadway Rd, Mesa, AZ 85204', street: '1202 E Broadway Rd', unit: null, city: 'Mesa', state: 'AZ', postalCode: '85204', disposition: 'callback', notes: 'Back after 6. Works swing shift.', contactName: null, contactPhone: null, contactEmail: null, occurredAt: hoursAgo(2.6), followUpAt: null },
  { id: 'v5', clientUuid: 'u5', addressId: 'a5', address: '1208 E Broadway Rd, Mesa, AZ 85204', street: '1208 E Broadway Rd', unit: null, city: 'Mesa', state: 'AZ', postalCode: '85204', disposition: 'no_answer', notes: null, contactName: null, contactPhone: null, contactEmail: null, occurredAt: hoursAgo(3.0), followUpAt: null },
  { id: 'v6', clientUuid: 'u6', addressId: 'a6', address: '1214 E Broadway Rd, Mesa, AZ 85204', street: '1214 E Broadway Rd', unit: null, city: 'Mesa', state: 'AZ', postalCode: '85204', disposition: 'no_answer', notes: null, contactName: null, contactPhone: null, contactEmail: null, occurredAt: hoursAgo(3.4), followUpAt: null },
  { id: 'v7', clientUuid: 'u7', addressId: 'a7', address: '1220 E Broadway Rd, Mesa, AZ 85204', street: '1220 E Broadway Rd', unit: null, city: 'Mesa', state: 'AZ', postalCode: '85204', disposition: 'interested', notes: 'Wants a number before she commits to a time.', contactName: 'Priya Raman', contactPhone: '480-555-0118', contactEmail: null, occurredAt: hoursAgo(3.9), followUpAt: null },
];

// The doors around the rep, including the one that matters most: a household
// that asked to be left alone.
export const NEARBY: NearbyAddress[] = [
  { id: 'a8', address: '1226 E Broadway Rd, Mesa, AZ 85204', street: '1226 E Broadway Rd', unit: null, city: 'Mesa', state: 'AZ', postalCode: '85204', lat: 33.4, lng: -111.8, lastDisposition: 'do_not_knock', lastVisitedAt: hoursAgo(200), visitCount: 2, doNotKnock: true },
  { id: 'a9', address: '1232 E Broadway Rd, Mesa, AZ 85204', street: '1232 E Broadway Rd', unit: null, city: 'Mesa', state: 'AZ', postalCode: '85204', lat: 33.4, lng: -111.8, lastDisposition: 'callback', lastVisitedAt: hoursAgo(52), visitCount: 3, doNotKnock: false },
  { id: 'a10', address: '1238 E Broadway Rd, Mesa, AZ 85204', street: '1238 E Broadway Rd', unit: null, city: 'Mesa', state: 'AZ', postalCode: '85204', lat: 33.4, lng: -111.8, lastDisposition: 'no_answer', lastVisitedAt: hoursAgo(74), visitCount: 1, doNotKnock: false },
  { id: 'a11', address: '1244 E Broadway Rd, Mesa, AZ 85204', street: '1244 E Broadway Rd', unit: null, city: 'Mesa', state: 'AZ', postalCode: '85204', lat: 33.4, lng: -111.8, lastDisposition: 'not_interested', lastVisitedAt: hoursAgo(96), visitCount: 1, doNotKnock: false },
];

// A believable week: 214 doors, a quarter of them answered, one sale. That
// is roughly 200 knocks per sale, which is what this work actually looks
// like.
export const STATS: FieldStats = {
  today: { visits: 34, doors: 34, contacts: 9, leads: 3, appointments: 1, sales: 0, contactRate: 0.2647, leadRate: 0.0882, closeRate: 0, knocksPerSale: null },
  week: { visits: 214, doors: 208, contacts: 52, leads: 14, appointments: 6, sales: 1, contactRate: 0.243, leadRate: 0.0654, closeRate: 0.0192, knocksPerSale: 214 },
};
