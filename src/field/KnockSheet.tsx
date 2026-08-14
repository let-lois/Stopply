// Recording what happened at a door.
//
// A bottom sheet rather than a centred dialog, because the outcome buttons
// have to land under a thumb and the top third of a phone is the hardest
// place to reach one-handed.
//
// The outcome is one tap and saves immediately. A note is optional and behind
// that, since most knocks have nothing worth typing and asking for one every
// time is how a rep stops logging them.

import { useEffect, useRef, useState } from 'react';
import { Car, X } from 'lucide-react';
import { useFieldActions, type Disposition, type Door } from '@/lib/field/FieldSessionProvider';
import { dispositionLabel } from '@/modules/field-sales/selectors';
import { ApiRequestError } from '@/lib/api/client';

// Ordered by how often a rep taps them, not by the order they appear in the
// enum. No answer is most of a day, so it comes first.
//
// Do not knock is not in this list. It is the one outcome that cannot be
// undone: the server keeps it sticky whatever arrives afterwards, precisely so
// a household that asked to be left alone stays left alone. Rendering it as a
// seventh pastel button next to No answer, which it closely resembled, meant a
// mis-tap was permanent. It is separated, styled as a warning rather than a
// choice, and asks a second time.
const OUTCOMES: Array<{ id: Disposition; tone: string }> = [
  { id: 'no_answer', tone: 'bg-[var(--color-accent-slate)]' },
  { id: 'come_back', tone: 'bg-[var(--color-accent-amber)]' },
  { id: 'not_interested', tone: 'bg-[var(--color-negative)]' },
  { id: 'interested', tone: 'bg-[var(--color-accent-sky)]' },
  { id: 'appointment_set', tone: 'bg-[var(--color-accent-purple)]' },
  { id: 'closed_sale', tone: 'bg-[var(--color-positive)]' },
];

// Showed and no-show are not knocks, they are what happened to an appointment
// somebody already booked. Offering them at every door would put two taps a
// rep will use twice a week in front of the six they use all day, and would
// invite marking a house "no-show" that never had an appointment. They appear
// only once a door is actually sitting at appointment_set.
const APPOINTMENT_OUTCOMES: Array<{ id: Disposition; tone: string }> = [
  { id: 'appointment_kept', tone: 'bg-[var(--color-accent-indigo)]' },
  { id: 'appointment_missed', tone: 'bg-[var(--color-accent-rose)]' },
];

export function KnockSheet({ door, onClose }: { door: Door; onClose: () => void }) {
  const { logKnock } = useFieldActions();
  const [notes, setNotes] = useState('');
  // Three-valued on purpose. Null is the state a rep leaves it in when they
  // did not look, and that is different from saying there was no car. A
  // boolean here would silently report "no vehicle" for every door in the day.
  const [vehiclePresent, setVehiclePresent] = useState<boolean | null>(null);
  const [saving, setSaving] = useState<Disposition | null>(null);
  const [confirmingDnk, setConfirmingDnk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const save = async (disposition: Disposition) => {
    setSaving(disposition);
    setError(null);
    try {
      await logKnock({
        propertyId: door.id,
        disposition,
        notes: notes.trim() || null,
        vehiclePresent,
      });
      onClose();
    } catch (cause) {
      // The knock is already on the phone by the time anything can throw, so
      // this is not "it was lost". Only a genuine refusal reaches here.
      setError(
        cause instanceof ApiRequestError ? cause.message : 'Saved on your phone. It will send when you have signal.'
      );
      setSaving(null);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Log a knock at ${door.address}`}
        className="relative max-h-[92dvh] overflow-y-auto rounded-t-3xl border-t border-[var(--color-hairline)] bg-[var(--color-surface-raised)] p-5 pb-8"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold">{door.address}</p>
            <p className="text-sm text-[var(--color-ink-soft)]">
              {door.city}, {door.state} {door.postalCode}
            </p>
            <p className="mt-1 text-sm text-[var(--color-ink-faint)]">
              Currently {dispositionLabel(door.disposition).toLowerCase()}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-12 shrink-0 place-items-center rounded-2xl border border-[var(--color-hairline)]"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {door.ownerName && (
          <p className="mb-4 text-sm">
            {door.ownerName}
            {door.ownerPhone && (
              <a
                href={`tel:${door.ownerPhone}`}
                className="ml-2 underline decoration-[var(--color-ink-faint)]"
              >
                {door.ownerPhone}
              </a>
            )}
          </p>
        )}

        {/* Above the note because it is an observation from the kerb, made
            before the door is even answered, and because a rep will tap it far
            more often than they will type. Tapping the selected side again
            clears it, so a mis-tap is recoverable without closing the sheet. */}
        <div className="mb-4">
          <p className="text-sm font-medium" id="vehicle-label">
            Car on the drive?
          </p>
          <div className="mt-2 flex gap-3" role="group" aria-labelledby="vehicle-label">
            {([true, false] as const).map((value) => {
              const active = vehiclePresent === value;
              return (
                <button
                  key={String(value)}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setVehiclePresent(active ? null : value)}
                  className={`min-h-14 flex-1 rounded-2xl border-2 text-base font-semibold ${
                    active
                      ? 'border-[var(--color-accent-sky)] bg-[var(--color-accent-sky)]/20 text-[var(--color-accent-sky)]'
                      : 'border-[var(--color-hairline)] text-[var(--color-ink-soft)]'
                  }`}
                >
                  <span className="flex items-center justify-center gap-2">
                    {value && <Car size={18} aria-hidden="true" />}
                    {value ? 'Yes' : 'No'}
                  </span>
                </button>
              );
            })}
          </div>
          {/* Says out loud what leaving it alone means, so a blank is a
              deliberate "did not look" rather than an accidental "no car". */}
          {vehiclePresent === null && (
            <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
              Leave both off if you did not check.
            </p>
          )}
        </div>

        <label className="mb-4 block">
          <span className="text-sm font-medium">Note (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Anything worth remembering"
            className="mt-2 w-full rounded-2xl border-2 border-[var(--color-hairline)] bg-well p-3 text-base outline-none focus-visible:border-[var(--color-accent-indigo)]"
          />
        </label>

        {error && (
          <p role="alert" className="mb-3 text-sm font-medium text-[var(--color-negative)]">
            {error}
          </p>
        )}

        {door.disposition === 'appointment_set' && (
          <div className="mb-3">
            <p className="mb-2 text-sm font-medium">This door has an appointment booked</p>
            <div className="grid grid-cols-2 gap-3">
              {APPOINTMENT_OUTCOMES.map((outcome) => (
                <button
                  key={outcome.id}
                  type="button"
                  disabled={saving !== null}
                  onClick={() => void save(outcome.id)}
                  className={`min-h-16 rounded-2xl px-3 text-base font-semibold text-[var(--color-on-accent-bright)] disabled:opacity-40 ${outcome.tone}`}
                >
                  {saving === outcome.id ? 'Saving…' : dispositionLabel(outcome.id)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {OUTCOMES.map((outcome) => (
            <button
              key={outcome.id}
              type="button"
              disabled={saving !== null}
              onClick={() => void save(outcome.id)}
              className={`min-h-16 rounded-2xl px-3 text-base font-semibold text-[var(--color-on-accent-bright)] disabled:opacity-40 ${outcome.tone}`}
            >
              {saving === outcome.id ? 'Saving…' : dispositionLabel(outcome.id)}
            </button>
          ))}
        </div>

        <div className="mt-6 border-t border-[var(--color-hairline)] pt-4">
          {confirmingDnk ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">
                This household will be marked do not knock permanently. Nobody on the crew
                will be offered this door again, and it cannot be undone from the app.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmingDnk(false)}
                  className="min-h-14 flex-1 rounded-2xl border-2 border-[var(--color-hairline)] text-base font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving !== null}
                  onClick={() => void save('do_not_knock')}
                  className="min-h-14 flex-1 rounded-2xl bg-[var(--color-negative)] text-base font-semibold text-[var(--color-on-accent)] disabled:opacity-40"
                >
                  {saving === 'do_not_knock' ? 'Saving…' : 'Yes, do not knock'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={saving !== null}
              onClick={() => setConfirmingDnk(true)}
              className="min-h-14 w-full rounded-2xl border-2 border-[var(--color-negative)] text-base font-semibold text-[var(--color-negative)] disabled:opacity-40"
            >
              Do not knock
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
