'use client';

// The screen a rep spends the whole shift on.
//
// Design rules it follows, all of them from what the job actually looks
// like: one thumb, bright sun, gloves sometimes, and a homeowner standing
// in front of them. So the outcome buttons are large and always visible,
// the address survives between knocks on the same street, nothing blocks on
// the network, and the form clears itself the instant a knock is logged so
// the rep can walk to the next door without tidying up.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fieldApi } from '@/lib/field/api';
import { enqueue, newClientUuid } from '@/lib/field/outbox';
import { describeAccuracy, getFix, isStale, type Fix } from '@/lib/field/geo';
import type { Disposition, NearbyAddress } from '@/lib/field/types';

// A crew works one neighbourhood at a time, so the city, state and postal
// code are the same for hours. Remembering them turns a five field form
// into a one field form for every door after the first.
const LOCALITY_KEY = 'stopply.field.locality.v1';

interface Locality {
  city: string;
  state: string;
  postalCode: string;
}

function readLocality(): Locality {
  if (typeof window === 'undefined') return { city: '', state: '', postalCode: '' };
  try {
    const raw = window.localStorage.getItem(LOCALITY_KEY);
    return raw ? (JSON.parse(raw) as Locality) : { city: '', state: '', postalCode: '' };
  } catch {
    return { city: '', state: '', postalCode: '' };
  }
}

function writeLocality(locality: Locality): void {
  try {
    window.localStorage.setItem(LOCALITY_KEY, JSON.stringify(locality));
  } catch {
    // Nothing to do. The rep just retypes the city next time.
  }
}

export function KnockForm({
  dispositions,
  onLogged,
}: {
  dispositions: Disposition[];
  onLogged: (message: string) => void;
}) {
  const [street, setStreet] = useState('');
  const [unit, setUnit] = useState('');
  const [locality, setLocality] = useState<Locality>({ city: '', state: '', postalCode: '' });
  const [disposition, setDisposition] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [fix, setFix] = useState<Fix | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [nearby, setNearby] = useState<NearbyAddress[] | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const streetRef = useRef<HTMLInputElement>(null);

  useEffect(() => setLocality(readLocality()), []);

  const chosen = useMemo(
    () => dispositions.find((d) => d.key === disposition) ?? null,
    [dispositions, disposition]
  );
  // Contact details are only asked for when the outcome implies there is
  // somebody to follow up with. Showing them on every knock would be five
  // extra fields for a "no answer", which is most of them.
  const wantsContact = !!chosen?.isLead;
  const wantsFollowUp = !!chosen && (chosen.isAppointment || chosen.key === 'callback');

  const locate = useCallback(async () => {
    setLocating(true);
    setGeoError(null);
    try {
      const next = await getFix();
      setFix(next);
      try {
        const res = await fieldApi<{ addresses: NearbyAddress[] }>(
          `/api/field/addresses/nearby?lat=${next.lat}&lng=${next.lng}`
        );
        setNearby(res.addresses);
      } catch {
        // Offline, or the lookup failed. Location itself still worked and
        // the knock can still be logged, so this stays quiet.
        setNearby(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'could not get a location';
      setGeoError(
        message === 'denied'
          ? 'Location is off for this app. You can still log knocks by typing the address.'
          : message
      );
    } finally {
      setLocating(false);
    }
  }, []);

  // Tapping a door the team already knows fills the address in and, more
  // importantly, surfaces what happened there last time before the rep
  // knocks it again.
  const useNearby = (address: NearbyAddress) => {
    setStreet(address.street);
    setUnit(address.unit ?? '');
    setLocality({
      city: address.city ?? locality.city,
      state: address.state ?? locality.state,
      postalCode: address.postalCode ?? locality.postalCode,
    });
    setWarning(
      address.doNotKnock
        ? 'This household asked not to be knocked again.'
        : address.lastDisposition
          ? `Last outcome here: ${labelFor(dispositions, address.lastDisposition)}.`
          : null
    );
    streetRef.current?.focus();
  };

  const reset = (keepStreet: boolean) => {
    if (!keepStreet) setStreet('');
    setUnit('');
    setDisposition(null);
    setNotes('');
    setContactName('');
    setContactPhone('');
    setContactEmail('');
    setFollowUpAt('');
    setWarning(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!street.trim() || !disposition) return;

    writeLocality(locality);
    // The fix is attached only if it is recent. A stale one would place the
    // door where the rep was ten minutes and two streets ago.
    const usable = isStale(fix) ? null : fix;

    enqueue({
      clientUuid: newClientUuid(),
      street: street.trim(),
      unit: unit.trim() || null,
      city: locality.city.trim() || null,
      state: locality.state.trim() || null,
      postalCode: locality.postalCode.trim() || null,
      disposition,
      notes: notes.trim() || null,
      contactName: wantsContact ? contactName.trim() || null : null,
      contactPhone: wantsContact ? contactPhone.trim() || null : null,
      contactEmail: wantsContact ? contactEmail.trim() || null : null,
      // The phone's clock at the door. The server keeps this rather than
      // arrival time, so a knock stays on the day it happened however long
      // it sat in the queue.
      occurredAt: new Date().toISOString(),
      lat: usable?.lat ?? null,
      lng: usable?.lng ?? null,
      accuracyM: usable?.accuracyM ?? null,
      followUpAt: wantsFollowUp && followUpAt ? new Date(followUpAt).toISOString() : null,
    });

    onLogged(`${labelFor(dispositions, disposition)} logged`);
    reset(false);
    streetRef.current?.focus();
  };

  return (
    <form className="knock-form" onSubmit={submit}>
      <section className="knock-block">
        <div className="knock-block-head">
          <h2>Where are you</h2>
          <button type="button" className="knock-locate" onClick={locate} disabled={locating}>
            {locating ? 'Locating' : fix ? 'Update location' : 'Use my location'}
          </button>
        </div>

        {fix && !geoError && (
          <p className="knock-hint">
            Location attached, {describeAccuracy(fix.accuracyM)}.
            {isStale(fix) && ' Getting old, tap update before your next knock.'}
          </p>
        )}
        {geoError && <p className="knock-hint knock-hint-warn">{geoError}</p>}

        {nearby && nearby.length > 0 && (
          <div className="knock-nearby">
            <p className="knock-hint">Doors near you the team has already worked:</p>
            <div className="knock-nearby-list">
              {nearby.slice(0, 8).map((a) => (
                <button type="button" key={a.id} className="knock-nearby-item" onClick={() => useNearby(a)}>
                  <span className="knock-nearby-address">{a.address}</span>
                  <span className="knock-nearby-meta">
                    {a.doNotKnock ? (
                      <strong className="knock-dnk">Do not knock</strong>
                    ) : (
                      <>
                        {labelFor(dispositions, a.lastDisposition)}
                        {a.visitCount > 1 && ` · ${a.visitCount} visits`}
                      </>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="knock-field">
          Street address
          <input
            ref={streetRef}
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            placeholder="123 N Main St"
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="next"
            required
          />
        </label>

        <div className="knock-row">
          <label className="knock-field knock-field-narrow">
            Unit
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Apt 2" autoComplete="off" />
          </label>
          <label className="knock-field">
            City
            <input
              value={locality.city}
              onChange={(e) => setLocality({ ...locality, city: e.target.value })}
              autoComplete="off"
              autoCapitalize="words"
            />
          </label>
        </div>

        <div className="knock-row">
          <label className="knock-field knock-field-narrow">
            State
            <input
              value={locality.state}
              onChange={(e) => setLocality({ ...locality, state: e.target.value })}
              autoComplete="off"
              maxLength={20}
            />
          </label>
          <label className="knock-field knock-field-narrow">
            ZIP
            <input
              value={locality.postalCode}
              onChange={(e) => setLocality({ ...locality, postalCode: e.target.value })}
              autoComplete="off"
              inputMode="numeric"
              maxLength={10}
            />
          </label>
        </div>

        {warning && <p className="knock-warning">{warning}</p>}
      </section>

      <section className="knock-block">
        <h2>How did it go</h2>
        <div className="knock-dispositions">
          {dispositions.map((d) => (
            <button
              type="button"
              key={d.key}
              className={`knock-disposition ${disposition === d.key ? 'selected' : ''}`.trim()}
              style={{ '--disposition-color': d.color ?? 'var(--ink-soft)' } as React.CSSProperties}
              aria-pressed={disposition === d.key}
              onClick={() => setDisposition(d.key)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </section>

      {wantsContact && (
        <section className="knock-block">
          <h2>Who did you talk to</h2>
          <label className="knock-field">
            Name
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} autoCapitalize="words" />
          </label>
          <label className="knock-field">
            Phone
            <input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              inputMode="tel"
              autoComplete="off"
            />
          </label>
          <label className="knock-field">
            Email
            <input
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              inputMode="email"
              autoComplete="off"
            />
          </label>
        </section>
      )}

      {wantsFollowUp && (
        <section className="knock-block">
          <h2>When are you back</h2>
          <label className="knock-field">
            Follow up
            <input type="datetime-local" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} />
          </label>
        </section>
      )}

      <section className="knock-block">
        <label className="knock-field">
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Anything worth remembering next time"
          />
        </label>
      </section>

      {/* Pinned so the action is always under the thumb, however far down
          the form the rep has scrolled. */}
      <div className="knock-submit-bar">
        <button className="knock-submit" type="submit" disabled={!street.trim() || !disposition}>
          {disposition ? `Log ${labelFor(dispositions, disposition).toLowerCase()}` : 'Pick an outcome'}
        </button>
      </div>
    </form>
  );
}

function labelFor(dispositions: Disposition[], key: string | null): string {
  if (!key) return 'Not knocked yet';
  return dispositions.find((d) => d.key === key)?.label ?? key;
}
