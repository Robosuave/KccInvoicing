import { requireSupabase } from '../lib/supabase';
import type { Invoice } from '../db/types';
import { logAuditEvent } from './audit';

const BUCKET = 'invoice-attachments';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function timesheetPath(workspaceId: string, invoice: Invoice): string {
  return `${workspaceId}/${invoice.business_id}/${invoice.id}/timesheet.pdf`;
}

/**
 * Uploads a timesheet PDF for an invoice and links it on the invoice record.
 * Replaces any existing timesheet. Returns the storage path.
 */
export async function uploadTimesheet(
  workspaceId: string,
  invoice: Invoice,
  file: File,
): Promise<string> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) throw new Error('The timesheet must be a PDF file.');
  if (file.size > MAX_BYTES) throw new Error('The timesheet PDF must be under 10 MB.');
  if (invoice.status === 'void') throw new Error('Cannot attach a timesheet to a voided invoice.');

  const sb = requireSupabase();
  const path = timesheetPath(workspaceId, invoice);
  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(path, file, { contentType: 'application/pdf', upsert: true });
  if (upErr) throw upErr;

  const { error: dbErr } = await sb
    .from('invoices')
    .update({ timesheet_path: path })
    .eq('id', invoice.id);
  if (dbErr) throw dbErr;

  await logAuditEvent(invoice.business_id, invoice.id, 'timesheet_attached', {
    invoice_number: invoice.invoice_number,
    filename: file.name,
  }).catch(() => { /* audit is non-critical */ });

  return path;
}

/** Removes the timesheet file and clears it from the invoice record. */
export async function removeTimesheet(workspaceId: string, invoice: Invoice): Promise<void> {
  const sb = requireSupabase();
  const path = invoice.timesheet_path ?? timesheetPath(workspaceId, invoice);
  const { error: rmErr } = await sb.storage.from(BUCKET).remove([path]);
  if (rmErr) throw rmErr;
  const { error: dbErr } = await sb
    .from('invoices')
    .update({ timesheet_path: null })
    .eq('id', invoice.id);
  if (dbErr) throw dbErr;

  await logAuditEvent(invoice.business_id, invoice.id, 'timesheet_removed', {
    invoice_number: invoice.invoice_number,
  }).catch(() => { /* audit is non-critical */ });
}

/** Short-lived download URL for a stored timesheet. */
export async function timesheetDownloadUrl(path: string): Promise<string> {
  const sb = requireSupabase();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 120);
  if (error || !data?.signedUrl) throw error ?? new Error('Could not create download link.');
  return data.signedUrl;
}
