// Log a knock.
//
// Three specific fixes from the prototype live here.
//
// The caller holds a property *id* and derives the object, so after saving,
// the panel behind this dialog shows the new status rather than the snapshot
// taken when the property was selected. That was the prototype's bug at
// exactly the moment a rep wants confirmation their knock registered.
//
// The disposition select resets after each save, so the next door does not
// inherit the last one's outcome.
//
// And the title never interpolates a possibly-null address: the prototype
// rendered "Log Door Visit — undefined" whenever nothing was selected.

import { useState } from 'react';
import type { Property, PropertyDisposition, Rep } from '@/modules/field-sales/types';
import { DISPOSITION_LABELS } from '@/modules/field-sales/selectors';
import { useFieldSalesActions } from '@/lib/state/FieldSalesProvider';
import { Button, Dialog } from '@/components/ui';

// Every outcome a rep can record at a door. 'not_visited' is absent by
// design: it is the absence of a knock, not something you can log one as.
const LOGGABLE: PropertyDisposition[] = [
  'no_answer',
  'come_back',
  'not_interested',
  'interested',
  'appointment_set',
  'closed_sale',
  'do_not_knock',
];

export function LogVisitDialog({
  property,
  reps,
  open,
  onClose,
}: {
  property: Property;
  reps: Rep[];
  open: boolean;
  onClose: () => void;
}) {
  const { logVisit } = useFieldSalesActions();
  const [disposition, setDisposition] = useState<PropertyDisposition | ''>('');
  const [notes, setNotes] = useState('');
  const [repId, setRepId] = useState(reps[0]?.id ?? '');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!disposition || !repId) return;

    logVisit({ propertyId: property.id, disposition, notes: notes.trim() || null, repId });

    // Cleared for the next door rather than left carrying this one's answer.
    setDisposition('');
    setNotes('');
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      // The property is required, so there is no null to interpolate.
      title="Log a knock"
      description={property.address}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" form="log-visit-form" type="submit" disabled={!disposition}>
            Save knock
          </Button>
        </>
      }
    >
      <form id="log-visit-form" onSubmit={submit} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="micro-label mb-2">Outcome</legend>
          <div className="grid grid-cols-2 gap-2">
            {LOGGABLE.map((option) => (
              <Button
                key={option}
                variant={disposition === option ? 'primary' : 'secondary'}
                aria-pressed={disposition === option}
                onClick={() => setDisposition(option)}
              >
                {DISPOSITION_LABELS[option]}
              </Button>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1.5 text-sm">
          Rep
          <select
            value={repId}
            onChange={(e) => setRepId(e.target.value)}
            className="min-h-10 rounded-xl border border-[var(--color-hairline)] bg-white/6 px-3"
          >
            {reps.map((rep) => (
              <option key={rep.id} value={rep.id}>
                {rep.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Anything worth remembering next time"
            className="rounded-xl border border-[var(--color-hairline)] bg-white/6 px-3 py-2"
          />
        </label>
      </form>
    </Dialog>
  );
}
