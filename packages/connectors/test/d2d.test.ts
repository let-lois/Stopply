// Door-to-door accounts parser. The fixture mirrors the real export's
// quirks: trailing spaces in stage headers ("Knock ", "Pitch "), BOTH an
// "Appointment" and an "Appointment " column (a stage and a disposition,
// nearly disjoint), dispatch-origin rows with no knock, purchased-list
// rows with no funnel activity at all, and stages crossing months.

import { describe, it, expect } from 'vitest';
import { parseD2dAccounts } from '../src/parsers';

const HEADER =
  'accountId,source,owner.name,closer.name,resident.firstName,resident.lastName,resident.email,resident.phone,createdDate,workflowStage,Start,Knock ,Pitch ,Appointment,Sit,Closed,Installed,Appointment ,Not Home';

const CSV = [
  HEADER,
  // Knocked in May, pitched, appointment set in May, sat and closed in June.
  'Account.1,,Jacob Gibson,Caleb Stolz,Melvin,Boone,,8047291827,2026-05-10T10:00:00.000+00:00,Closed,2026-05-10T10:00:00.000+00:00,2026-05-10T10:00:00.000+00:00,2026-05-10T10:05:00.000+00:00,2026-05-12T17:00:00.000+00:00,2026-06-02T17:00:00.000+00:00,2026-06-02T18:00:00.000+00:00,,,',
  // Knocked in May, not home. No pitch, no appointment.
  'Account.2,,George Sanders,,Ann,Lee,,7571112222,2026-05-11T12:00:00.000+00:00,Not Home,2026-05-11T12:00:00.000+00:00,2026-05-11T12:00:00.000+00:00,,,,,,,2026-05-11T12:00:00.000+00:00',
  // Dispatch origin: no knock, appointment lives in the DUPLICATE
  // "Appointment " column (the disposition one), sat in May.
  'Account.3,ReadyMode,Zaniyah Bright,Lauren McAvoy,Bob,Hill,bob@x.com,7573334444,2026-05-01T09:00:00.000+00:00,Sat - No Close,2026-05-01T09:00:00.000+00:00,,,,2026-05-20T15:00:00.000+00:00,,,2026-05-18T10:00:00.000+00:00,',
  // Purchased list row with zero funnel activity: must be skipped.
  'Account.4,Terros,,,Dora,None,,,2026-05-02T08:00:00.000+00:00,Does Not Qualify - Other,2026-05-02T08:00:00.000+00:00,,,,,,,,',
].join('\n');

describe('d2d accounts parser', () => {
  it('May: contacts, stage events, and rep counters land in the right buckets', () => {
    const res = parseD2dAccounts(CSV, '2026-05');
    expect(res.kind).toBe('d2d-accounts');

    // Account.4 has no funnel activity and is excluded entirely.
    expect(res.contacts).toHaveLength(3);
    const byRef = Object.fromEntries(res.contacts!.map((c) => [c.externalRef, c]));
    expect(byRef['Account.1'].channel).toBe('Door to Door');
    expect(byRef['Account.3'].channel).toBe('Dispatch');
    expect(byRef['Account.1'].phoneLast10).toBe('8047291827');

    const stages = res.d2dStageEvents!.map((e) => `${e.contactId}:${e.stage}`).sort();
    expect(stages).toEqual(
      [
        'Account.1:lead',
        'Account.1:scheduled',
        'Account.2:lead',
        'Account.3:lead',
        'Account.3:scheduled', // from the duplicate "Appointment " column
        'Account.3:completed',
      ].sort()
    );

    const reps = Object.fromEntries(res.repMetrics!.map((r) => [r.rep, r]));
    expect(reps['Jacob Gibson']).toMatchObject({ knocks: 1, pitches: 1, appointmentsSet: 1 });
    expect(reps['George Sanders']).toMatchObject({ knocks: 1, pitches: 0 });
    expect(reps['Zaniyah Bright']).toMatchObject({ appointmentsSet: 1, sitsSet: 1 });
    expect(reps['Lauren McAvoy']).toMatchObject({ sitsRun: 1 });
  });

  it('June: only the sit and close cross over, attributed to the closer', () => {
    const res = parseD2dAccounts(CSV, '2026-06');
    // No contacts were created in June.
    expect(res.contacts).toHaveLength(0);
    const stages = res.d2dStageEvents!.map((e) => `${e.contactId}:${e.stage}`).sort();
    expect(stages).toEqual(['Account.1:completed', 'Account.1:purchase'].sort());
    const reps = Object.fromEntries(res.repMetrics!.map((r) => [r.rep, r]));
    expect(reps['Caleb Stolz']).toMatchObject({ sitsRun: 1, closes: 1 });
    expect(reps['Jacob Gibson']).toMatchObject({ sitsSet: 1 });
  });

  it('blank owner or closer falls back to Unattributed', () => {
    const csv = [
      HEADER,
      'Account.9,,,,X,Y,,,2026-05-01T00:00:00.000+00:00,Closed,2026-05-01T00:00:00.000+00:00,2026-05-01T00:00:00.000+00:00,,,2026-05-03T00:00:00.000+00:00,2026-05-04T00:00:00.000+00:00,,,',
    ].join('\n');
    const res = parseD2dAccounts(csv, '2026-05');
    const reps = Object.fromEntries(res.repMetrics!.map((r) => [r.rep, r]));
    expect(reps['Unattributed']).toMatchObject({ knocks: 1, sitsRun: 1, closes: 1 });
  });
});
