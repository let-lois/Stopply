'use client';

// A friendly wrapper for anything that looks like code: tracking snippets,
// signing secrets, DNS records. Collapsed by default with a plain language
// label so people who are nervous about code can leave it closed and come
// back to it later. Includes a one tap copy button.

import { useState } from 'react';

export function CodeBox({
  code,
  label = 'Code snippet',
  hint = 'Safe to skip — your developer can handle this later.',
  defaultOpen = false,
  language,
}: {
  code: string;
  label?: string;
  hint?: string;
  defaultOpen?: boolean;
  language?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="codebox">
      <button
        type="button"
        className="codebox-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="codebox-title">
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          {'</>'} {label}
        </span>
        <span className="codebox-hint">{open ? 'Hide' : hint}</span>
      </button>
      {open && (
        <div className="codebox-body">
          <pre>
            <code data-language={language}>{code}</code>
          </pre>
          <div className="codebox-actions">
            <button type="button" className="small" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
