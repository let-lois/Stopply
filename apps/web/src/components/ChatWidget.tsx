'use client';

// Chat widget placeholder for Phase 5; Phase 6 wires help search, the
// Claude assistant, role scoped tools, and code mode into this shell.

import { useState } from 'react';
import type { TenantSettings } from '@/lib/types';

export function ChatWidget({ settings, currentTab }: { settings: TenantSettings; currentTab: string }) {
  const [open, setOpen] = useState(false);
  void settings;
  void currentTab;
  return (
    <>
      <button className="chat-fab" onClick={() => setOpen((o) => !o)} aria-label="Help and assistant">
        ?
      </button>
      {open && (
        <div className="chat-panel">
          <div style={{ padding: 16 }}>
            <strong>Help</strong>
            <p className="muted">The assistant arrives with the next update.</p>
          </div>
        </div>
      )}
    </>
  );
}
