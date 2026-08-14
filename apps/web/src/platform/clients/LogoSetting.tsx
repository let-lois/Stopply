// Setting a workspace's own mark.
//
// The file never leaves the browser as a file. It is read into a data URI and
// sent as JSON to the same endpoint everything else here uses, which avoids a
// multipart upload path, an object store, and a second place for a workspace's
// data to live. The ceiling that makes this reasonable is enforced on the
// server as well; see server/routes/clients.ts.

import { useRef, useState } from 'react';
import { ImageUp, Trash2 } from 'lucide-react';
import { BrandMark, Button, Card } from '@/components/ui';
import { checkLogo, LOGO_MAX_CHARS, LOGO_MIME_TYPES } from '@/lib/brand/logo';
import { brandForClient } from '@/lib/brand/useBrand';
import { ApiRequestError } from '@/lib/api/client';
import type { Client } from '@/types';

/** Read a file as a data URI, or reject with something worth showing. */
function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('That file could not be read.'));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

export function LogoSetting({
  client,
  onSave,
}: {
  client: Client;
  /** Null clears the mark and returns the workspace to its monogram. */
  onSave: (logo: string | null) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setBusy(true);
    try {
      const dataUri = await readAsDataUri(file);
      // Checked here for a quick answer and again on the server, which is the
      // one that decides. The picker's `accept` is a filter, not a rule: a
      // file can be renamed and a drag-and-drop ignores it entirely.
      const bad = checkLogo(dataUri);
      if (bad) {
        setProblem(bad.message);
        return;
      }
      await onSave(dataUri);
    } catch (cause) {
      setProblem(
        cause instanceof ApiRequestError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : 'That logo could not be saved.'
      );
    } finally {
      setBusy(false);
      // Cleared so choosing the same file twice fires a change event the
      // second time, which is what makes a retry after a failure work.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async () => {
    setProblem(null);
    setBusy(true);
    try {
      await onSave(null);
    } catch (cause) {
      setProblem(
        cause instanceof ApiRequestError ? cause.message : 'That logo could not be removed.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <p className="micro-label mb-2">Logo</p>
      <p className="mb-4 max-w-2xl text-sm text-[var(--color-ink-soft)]">
        Shown in the header, in the browser tab, and in the field app your reps carry.
        Without one, this workspace uses the initials below.
      </p>

      <div className="flex flex-wrap items-center gap-4">
        {/* The live brand, not a preview of the file: what is drawn here is
            exactly what the header will draw, from the same component. */}
        <BrandMark brand={brandForClient(client)} size={64} />

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={LOGO_MIME_TYPES.join(',')}
            className="sr-only"
            id="workspace-logo"
            disabled={busy}
            onChange={(e) => void choose(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <ImageUp size={16} aria-hidden="true" />
            {busy ? 'Saving' : client.logo ? 'Replace logo' : 'Upload a logo'}
          </Button>

          {client.logo && (
            <Button type="button" variant="danger" disabled={busy} onClick={() => void remove()}>
              <Trash2 size={16} aria-hidden="true" />
              Remove
            </Button>
          )}
        </div>
      </div>

      {problem && (
        <p role="alert" className="mt-3 text-sm text-[var(--color-negative)]">
          {problem}
        </p>
      )}

      <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
        PNG, JPEG or WebP, under {Math.floor(LOGO_MAX_CHARS / 1024)}KB. A square image
        looks best; anything else is fitted rather than cropped.
      </p>
    </Card>
  );
}
