// Door to door, read from the BI platform.
//
// Four reads inside one tenant selection, because the platform serves the
// catalog, the roster, the doors and the knocks from four routes and the
// selection is per session rather than per request. Doing them inside one
// withTenant means one switch and one verification for the page rather than
// four of each, and no window in which the selection moves between them.
//
// Two shape differences are worth naming rather than leaving to be discovered:
//
//   1. The platform has no territories. Its field tables are addresses,
//      visits, reps and dispositions, and nothing groups doors into an area.
//      An empty list is what this returns, and the Territories view already
//      handles that: it is the state a client sits in before anyone draws one.
//   2. Its addresses are a single formatted line, not city/state/postcode
//      columns. Parsed below on a best effort basis and left partly empty
//      where the line does not carry the parts, rather than guessed at.

import type {
  FieldSalesSlice,
  Property,
  Rep,
  Visit,
} from '@/modules/field-sales/types';
import {
  buildCatalog,
  rankFromFlags,
  FALLBACK_HEX,
  type DispositionCatalog,
  type DispositionEntry,
} from '@/modules/field-sales/catalog';
import { platformRequest } from '@/lib/api/platform/wire';
import { withTenant } from '@/lib/api/platform/tenantContext';
import { z } from 'zod';

const dispositionRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  sort_order: z.number(),
  is_contact: z.number(),
  is_lead: z.number(),
  is_appointment: z.number(),
  is_sale: z.number(),
  marks_do_not_knock: z.number(),
  color: z.string().nullable(),
});

const repRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  team: z.string().nullable(),
  active: z.number(),
});

const addressRowSchema = z.object({
  id: z.string(),
  address: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  lastDisposition: z.string().nullable(),
  doNotKnock: z.boolean(),
});

const visitRowSchema = z.object({
  id: z.string(),
  repId: z.string(),
  address: z.string(),
  disposition: z.string(),
  notes: z.string().nullable(),
  occurredAt: z.string(),
});

const dispositionsSchema = z.object({ dispositions: z.array(dispositionRowSchema) });
const repsSchema = z.object({ reps: z.array(repRowSchema) });
const addressesSchema = z.object({ addresses: z.array(addressRowSchema) });
const visitsSchema = z.object({ visits: z.array(visitRowSchema) });

type DispositionRow = z.infer<typeof dispositionRowSchema>;
type AddressRow = z.infer<typeof addressRowSchema>;

/**
 * The client's own outcome catalog, ranked by its flags.
 *
 * This is the whole reason catalog.ts exists. A client who renames "Sold" or
 * adds "Left a quote" keeps a working funnel, because the rank comes from
 * is_sale and is_contact rather than from anything recognising the word.
 */
export function catalogFromRows(rows: DispositionRow[]): DispositionCatalog {
  const ordered = [...rows].sort((a, b) => a.sort_order - b.sort_order);
  const entries: DispositionEntry[] = ordered.map((row, index) => {
    // The platform lets a colour be null. Cycling the fallbacks by position
    // keeps two custom outcomes from landing on the same colour.
    const hex = row.color ?? FALLBACK_HEX[index % FALLBACK_HEX.length]!;
    return {
      key: row.key,
      label: row.label,
      rank: rankFromFlags(row),
      marksDoNotKnock: row.marks_do_not_knock === 1,
      hex,
      lightHex: hex,
    };
  });
  // A door nobody has knocked is not one of the platform's outcomes: it has no
  // row in its catalog because it has no visit. The views still need something
  // to colour and label it, so it is added here at rank 0.
  return buildCatalog([
    {
      key: 'not_visited',
      label: 'Not visited',
      rank: 0,
      marksDoNotKnock: false,
      hex: '#6b7280',
      lightHex: '#6b7280',
    },
    ...entries,
  ]);
}

/**
 * Split a formatted address line into the parts the views show separately.
 *
 * "1700 Magnolia Ave, Riverside, CA 92503" is the shape the platform's field
 * app writes, so it is the shape this reads. Anything that does not match
 * keeps the whole line as the street and leaves the rest empty, which shows
 * the address the client actually stored rather than a mangled version of it.
 */
export function splitAddress(line: string): Pick<
  Property,
  'address' | 'city' | 'state' | 'postalCode'
> {
  const parts = line.split(',').map((p) => p.trim());
  if (parts.length < 3) return { address: line, city: '', state: '', postalCode: '' };
  const region = /^([A-Za-z ]+?)\s+([\d-]+)$/.exec(parts[parts.length - 1] ?? '');
  return {
    address: parts.slice(0, parts.length - 2).join(', '),
    city: parts[parts.length - 2] ?? '',
    state: region?.[1]?.trim() ?? (parts[parts.length - 1] ?? ''),
    postalCode: region?.[2] ?? '',
  };
}

function toProperty(row: AddressRow): Property {
  return {
    id: row.id,
    ...splitAddress(row.address),
    // 0,0 is in the Gulf of Guinea. A door with no coordinates is dropped by
    // the caller rather than drawn there, so this is only a placeholder for
    // the type and never reaches a map.
    lat: row.lat ?? 0,
    lng: row.lng ?? 0,
    // The platform has no territories, so every door belongs to none. The
    // views read this as unassigned, which is accurate.
    territoryId: '',
    // do_not_knock is sticky on the address and outranks whatever the last
    // visit said, which is the platform's own rule and the one place a flag on
    // the address beats the visit log.
    disposition: row.doNotKnock ? 'do_not_knock' : (row.lastDisposition ?? 'not_visited'),
    ownerName: null,
    ownerPhone: null,
    notes: null,
  };
}

export interface PlatformFieldSales extends FieldSalesSlice {
  /** The client's own catalog. Every reporting call has to be handed this. */
  catalog: DispositionCatalog;
}

export function fetchFieldSalesFromPlatform(
  clientId: string,
  signal?: AbortSignal
): Promise<PlatformFieldSales> {
  return withTenant(
    clientId,
    async (inner) => {
      const opts = inner ? { signal: inner } : {};
      const [dispositions, reps, addresses, visits] = await Promise.all([
        platformRequest('/api/tenant/field/dispositions', dispositionsSchema, opts),
        platformRequest('/api/tenant/field/reps', repsSchema, opts),
        platformRequest('/api/tenant/field/addresses', addressesSchema, opts),
        platformRequest('/api/tenant/field/visits', visitsSchema, opts),
      ]);

      const catalog = catalogFromRows(dispositions.dispositions);
      const properties = addresses.addresses.map(toProperty);
      // Visits name their address by its text, not by an id, so this is the
      // join. A visit whose address is not in the list is dropped rather than
      // attached to a placeholder door: it would otherwise land on the map at
      // a location nobody knocked.
      const propertyIdByAddress = new Map(
        addresses.addresses.map((a) => [a.address, a.id])
      );

      const mappedVisits: Visit[] = visits.visits
        .map((v): Visit | null => {
          const propertyId = propertyIdByAddress.get(v.address);
          if (!propertyId) return null;
          return {
            id: v.id,
            propertyId,
            repId: v.repId,
            disposition: v.disposition,
            notes: v.notes,
            // The platform does not record whether a car was on the drive.
            // Null is exactly what that field means: the rep did not say.
            vehiclePresent: null,
            occurredAt: v.occurredAt,
          };
        })
        .filter((v): v is Visit => v !== null);

      // The platform has no territories, so no rep is assigned to one. Null
      // is what the type already means by that, and the roster views read it
      // as unassigned rather than as missing data.
      const mappedReps: Rep[] = reps.reps.map((r) => ({
        id: r.id,
        name: r.name,
        territoryId: null,
      }));

      return {
        properties,
        visits: mappedVisits,
        territories: [],
        reps: mappedReps,
        catalog,
      };
    },
    signal
  );
}
