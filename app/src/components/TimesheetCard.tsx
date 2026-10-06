import { useCallback, useEffect, useRef, useState } from 'react';
import { useBusiness } from '../business/BusinessContext';
import { getInvoice } from '../data/invoices';
import { uploadTimesheet, removeTimesheet, timesheetDownloadUrl } from '../data/attachments';
import type { Invoice } from '../db/types';
import { Alert, Button } from './ui';

/**
 * Timesheet PDF attachment card. Used on both the draft editor and the issued
 * invoice view so the timesheet can be attached before emailing.
 */
export default function TimesheetCard({ invoiceId, onTimesheetChange }: {
  invoiceId: string;
  onTimesheetChange?: (path: string | null) => void;
}) {
  const { workspace } = useBusiness();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const { invoice: inv } = await getInvoice(invoiceId);
      setInvoice(inv);
      onTimesheetChange?.(inv.timesheet_path ?? null);
    } catch {
      /* keep previous state */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  useEffect(() => { load(); }, [load]);

  const applyPath = (path: string | null) => {
    setInvoice((inv) => (inv ? { ...inv, timesheet_path: path } : inv));
    onTimesheetChange?.(path);
  };

  const doUpload = async (file: File | undefined) => {
    if (!file || !invoice || !workspace) return;
    setError(null);
    setBusy(true);
    try {
      const path = await uploadTimesheet(workspace.id, invoice, file);
      applyPath(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const doRemove = async () => {
    if (!invoice || !workspace) return;
    if (!window.confirm('Remove the timesheet from this invoice?')) return;
    setError(null);
    setBusy(true);
    try {
      await removeTimesheet(workspace.id, invoice);
      applyPath(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Remove failed.');
    } finally {
      setBusy(false);
    }
  };

  const doDownload = async () => {
    if (!invoice?.timesheet_path) return;
    setBusy(true);
    try {
      const url = await timesheetDownloadUrl(invoice.timesheet_path);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!invoice || invoice.status === 'void') return null;

  return (
    <div className="card">
      <div className="btn-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Attachments</h2>
      </div>
      {invoice.timesheet_path ? (
        <div className="btn-row" style={{ alignItems: 'center' }}>
          <span style={{ fontSize: 14 }}>
            Timesheet PDF attached — it will be included when you email this invoice.
          </span>
          <Button size="sm" variant="secondary" onClick={doDownload} disabled={busy}>View</Button>
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>Replace</Button>
          <Button size="sm" variant="ghost" onClick={doRemove} disabled={busy}>Remove</Button>
        </div>
      ) : (
        <div className="btn-row" style={{ alignItems: 'center' }}>
          <span style={{ fontSize: 14, color: 'var(--muted)' }}>No timesheet attached.</span>
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? 'Uploading…' : 'Attach timesheet PDF'}
          </Button>
        </div>
      )}
      <input
        ref={fileRef}
        id={`ts-file-${invoiceId}`}
        type="file"
        accept="application/pdf,.pdf"
        // Visually hidden but still rendered: some mobile browsers won't
        // open the picker for a display:none input triggered by script.
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
        onChange={(e) => { doUpload(e.target.files?.[0]); e.target.value = ''; }}
      />
      {error && <Alert kind="error">{error}</Alert>}
    </div>
  );
}

/**
 * Compact "Attach PDF" button that sits next to the Email invoice button.
 * It's a <label> for the TimesheetCard's file input (native activation is the
 * most reliable way to open the picker on mobile). The full card below still
 * handles view/replace/remove.
 */
export function TimesheetAttachLabel({ invoiceId, timesheetPath }: {
  invoiceId: string;
  timesheetPath: string | null;
}) {
  return (
    <label
      htmlFor={`ts-file-${invoiceId}`}
      className="btn btn-secondary btn-sm"
      style={{ cursor: 'pointer', margin: 0 }}
    >
      {timesheetPath ? '✓ PDF attached' : 'Attach PDF'}
    </label>
  );
}
