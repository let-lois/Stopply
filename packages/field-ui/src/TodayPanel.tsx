'use client';

// What the rep has logged, queued knocks first.
//
// Queued and saved are shown in one list rather than two, because to the
// rep they are the same thing: work they did. The only difference that
// matters is whether it has reached the office yet, which is a small mark
// rather than a separate section.

import { useState } from 'react';
import { FieldApiError, fieldApi } from './api';
import { discard } from './outbox';
import type { Disposition, OutboxEntry, SavedVisit } from './types';

// A rep can correct a knock for a day after it happened. The server
// enforces the same window, this just avoids offering a button that would
// be refused.
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function TodayPanel({
  visits,
  queued,
  dispositions,
  timezone,
  onChanged,
}: {
  visits: SavedVisit[] | null;
  queued: OutboxEntry[];
  dispositions: Disposition[];
  timezone: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const label = (key: string) => dispositions.find((d) => d.key === key)?.label ?? key;
  const color = (key: string) => dispositions.find((d) => d.key === key)?.color ?? 'var(--ink-soft)';

  const pending = queued.filter((e) => !e.rejected);
  const nothingYet = pending.length === 0 && (visits?.length ?? 0) === 0;

  const saveNote = async (visit: SavedVisit) => {
    setError(null);
    try {
      await fieldApi(`/api/field/visits/${visit.id}`, {
        method: 'PATCH',
        json: { notes: draft.trim() || null },
      });
      setEditing(null);
      onChanged();
    } catch (err) {
      setError(
        err instanceof FieldApiError ? err.message : 'No connection, your note was not saved yet'
      );
    }
  };

  return (
    <div className="field-list">
      {nothingYet && (
        <p className="field-empty">
          Nothing logged yet. Knocks you record show up here, whether or not you have signal.
        </p>
      )}

      {pending.map((entry) => (
        <article className="field-visit field-visit-queued" key={entry.visit.clientUuid}>
          <div className="field-visit-head">
            <span className="field-visit-dot" style={{ background: color(entry.visit.disposition) }} />
            <div>
              <p className="field-visit-address">
                {[entry.visit.street, entry.visit.unit ? `#${entry.visit.unit}` : null]
                  .filter(Boolean)
                  .join(' ')}
              </p>
              <p className="field-visit-meta">
                {label(entry.visit.disposition)} · {clock(entry.visit.occurredAt, timezone)} · on this
                phone
              </p>
            </div>
          </div>
          {entry.visit.notes && <p className="field-visit-notes">{entry.visit.notes}</p>}
          {entry.attempts > 2 && (
            <p className="field-visit-meta">
              Still waiting for signal. It will send on its own.{' '}
              <button
                type="button"
                className="field-linklike"
                onClick={() => discard(entry.visit.clientUuid)}
              >
                Remove
              </button>
            </p>
          )}
        </article>
      ))}

      {visits?.map((visit) => {
        const editable = Date.now() - Date.parse(visit.occurredAt) < EDIT_WINDOW_MS;
        return (
          <article className="field-visit" key={visit.id}>
            <div className="field-visit-head">
              <span className="field-visit-dot" style={{ background: color(visit.disposition) }} />
              <div>
                <p className="field-visit-address">{visit.address}</p>
                <p className="field-visit-meta">
                  {label(visit.disposition)} · {clock(visit.occurredAt, timezone)}
                  {visit.contactName ? ` · ${visit.contactName}` : ''}
                </p>
              </div>
            </div>

            {editing === visit.id ? (
              <div className="field-visit-edit">
                <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
                {error && <p className="field-error">{error}</p>}
                <div className="field-visit-actions">
                  <button type="button" onClick={() => void saveNote(visit)}>
                    Save note
                  </button>
                  <button type="button" className="field-linklike" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {visit.notes && <p className="field-visit-notes">{visit.notes}</p>}
                {editable && (
                  <button
                    type="button"
                    className="field-linklike"
                    onClick={() => {
                      setEditing(visit.id);
                      setDraft(visit.notes ?? '');
                      setError(null);
                    }}
                  >
                    {visit.notes ? 'Edit note' : 'Add a note'}
                  </button>
                )}
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}

// Time of day in the client's timezone, which is where the rep is working
// even if their phone is set to somewhere else.
function clock(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}
