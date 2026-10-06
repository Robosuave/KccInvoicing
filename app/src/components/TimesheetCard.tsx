import { useCallback, useEffect, useState } from 'react';
import { useBusiness } from '../business/BusinessContext';
import type { Invoice } from '../db/types';
import { getInvoice } from '../data/invoices';
import {
  removeTimesheet,
  timesheetDownloadUrl,
  uploadTimesheet,
} from '../data/attachments';
import { Alert, Button } from './ui';

export interface TimesheetState {
  attachedPath: string | null;
  busy: boolean;
  status: string | null;
  error: string | null;
  uploadFile: (file: File | undefined) => Promise<void>;
  removeFile: () => Promise<void>;
}

/**
 * Shared timesheet state for one invoice. A single hook instance is created
 * by the parent and passed to both the attach button (top of the screen) and
 * the Attachments card, so the status is always visible where the user tapped.
 */
export function useTimesheet(
  invoiceId: string | null,
  onTimesheetChange?: (path: string | null) => void,
): TimesheetState {
  const { workspace } = useBusiness();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [attached, setAttached] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInvoice(null);
    setAttached(null);
    setError(null);
    if (!invoiceId) return;
    getInvoice(invoiceId).then(
      ({ invoice: inv }) => {
        if (cancelled) return;
        setInvoice(inv);
        setAttached(inv.timesheet_path ?? null);
      },
      () => {
        if (!cancelled) setError('Could not load the invoice.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  const applyPath = useCallback(
    (path: string | null) => {
      setAttached(path);
      onTimesheetChange?.(path);
    },
    [onTimesheetChange],
  );

  const uploadFile = useCallback(
    async (file: File | undefined) => {
      if (!file) {
        setError('The picker did not return a file. Tap Attach PDF and choose the PDF again.');
        return;
      }
      if (!invoice || !workspace) {
        setError('The invoice is still loading. Wait a moment and try again.');
        return;
      }
      setError(null);
      setBusy(true);
      try {
        const kb = Math.max(1, Math.round(file.size / 1024));
        setStatus(`Picked "${file.name}" (${kb} KB) — uploading…`);
        const path = await uploadTimesheet(workspace.id, invoice, file, setStatus);
        applyPath(path);
        setStatus(null);
      } catch (e) {
        setStatus(null);
        setError(e instanceof Error ? e.message : 'Upload failed.');
      } finally {
        setBusy(false);
      }
    },
    [invoice, workspace, applyPath],
  );

  const removeFile = useCallback(async () => {
    if (!invoice || !workspace || !attached) return;
    if (!window.confirm('Remove the attached timesheet PDF?')) return;
    setError(null);
    setBusy(true);
    try {
      await removeTimesheet(workspace.id, invoice);
      applyPath(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the timesheet.');
    } finally {
      setBusy(false);
    }
  }, [invoice, workspace, attached, applyPath]);

  return { attachedPath: attached, busy, status, error, uploadFile, removeFile };
}

/**
 * "Attach PDF" button. The file input lives INSIDE the label (implicit
 * association) — the most reliable activation pattern on mobile browsers.
 * Status and errors render directly under the button so they are visible
 * without scrolling.
 */
export function TimesheetAttachButton({ ts }: { ts: TimesheetState }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, maxWidth: '100%' }}>
      <label className="btn btn-secondary btn-sm" style={{ opacity: ts.busy ? 0.7 : 1 }}>
        {ts.busy ? 'Uploading…' : ts.attachedPath ? '✓ PDF attached' : 'Attach PDF'}
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="ts-file-input"
          disabled={ts.busy}
          onChange={(e) => {
            void ts.uploadFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {(ts.status || ts.error) && (
        <span style={{ fontSize: 13, color: ts.error ? 'var(--danger)' : 'var(--muted)' }}>
          {ts.error ?? ts.status}
        </span>
      )}
    </span>
  );
}

export default function TimesheetCard({ ts }: { ts: TimesheetState }) {
  const download = async () => {
    if (!ts.attachedPath) return;
    try {
      const url = await timesheetDownloadUrl(ts.attachedPath);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'timesheet.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      /* download errors stay silent; the attached state is unchanged */
    }
  };

  return (
    <div className="card no-print">
      <div className="btn-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Attachments</h2>
        {ts.attachedPath && (
          <Button size="sm" variant="secondary" onClick={() => void ts.removeFile()} disabled={ts.busy}>
            Remove
          </Button>
        )}
      </div>
      {ts.attachedPath ? (
        <p style={{ margin: '8px 0 0' }}>
          <button type="button" className="linklike" onClick={() => void download()}>
            timesheet.pdf
          </button>{' '}
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            — attached and will be included when emailed.
          </span>
        </p>
      ) : (
        <p style={{ color: 'var(--muted)', margin: '8px 0 0', fontSize: 14 }}>
          No timesheet attached. Tap Attach PDF above — PDF only, up to 10&nbsp;MB.
        </p>
      )}
      {ts.error && <Alert kind="error">{ts.error}</Alert>}
    </div>
  );
}
