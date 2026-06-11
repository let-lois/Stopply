'use client';

// The three state source check icon with the persistent hover popup.
// Reproduces the Be Clinical showTip and scheduleHide behavior: the popup
// stays open while the mouse is over it, and hides on a short delay after
// leaving both the icon and the popup.

import { useRef, useState } from 'react';
import type { SourceInfo } from '@/lib/types';
import { fmtStamp } from '@/lib/format';
import { api } from '@/lib/api';
import { useToast } from './Toasts';

export function SourceCheck({
  source,
  timezone,
  canVerify,
  onVerified,
}: {
  source: SourceInfo;
  timezone: string;
  canVerify: boolean;
  onVerified: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useToast();

  const showTip = (e: React.MouseEvent) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPos({ x: Math.min(rect.left, window.innerWidth - 340), y: rect.bottom + window.scrollY + 6 });
    setOpen(true);
  };

  const scheduleHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setOpen(false), 250);
  };

  const cancelHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  };

  const verify = async () => {
    try {
      await api(`/api/tenant/sources/${source.key}/verify`, { method: 'POST' });
      toast(`${source.name} verified`);
      setOpen(false);
      onVerified();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'verify failed');
    }
  };

  const stateLabel =
    source.freshness === 'green' ? 'Verified' : source.freshness === 'red' ? 'Stale' : 'Imported, not verified';

  return (
    <>
      <span
        className={`check ${source.freshness}`}
        onMouseEnter={showTip}
        onMouseLeave={scheduleHide}
        onClick={showTip}
        role="button"
        aria-label={`${source.name}: ${stateLabel}`}
      />
      {open && (
        <div
          className="popup"
          style={{ left: pos.x, top: pos.y }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          <div className="stack" style={{ gap: 6 }}>
            <strong>{source.name}</strong>
            <span>
              State: <b>{stateLabel}</b>
            </span>
            <span className="muted">Records through: {source.records_through ?? 'unknown'}</span>
            <span className="muted">Imported: {fmtStamp(source.last_import_at, timezone)}</span>
            <span className="muted">
              Verified: {source.verified_at ? `${fmtStamp(source.verified_at, timezone)} by ${source.verified_by}` : 'not yet'}
            </span>
            {source.how_to && <p style={{ margin: '4px 0' }}>{source.how_to}</p>}
            {source.platform_link && (
              <a href={source.platform_link} target="_blank" rel="noreferrer">
                Open platform
              </a>
            )}
            {canVerify && (
              <button className="small primary" onClick={verify}>
                {source.kind === 'integration' ? 'Verify (or re pull from Data and Team)' : 'Verify'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
