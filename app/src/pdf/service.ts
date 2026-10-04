import { pdf } from '@react-pdf/renderer';
import { InvoicePdf, invoicePdfFilename, type PdfPageSize } from './InvoicePdf';
import { ReceiptPdf, receiptPdfFilename } from './ReceiptPdf';
import { requireSupabase } from '../lib/supabase';
import { getLogoUrl } from '../data/businesses';
import type { InvoiceSnapshot } from '../lib/snapshot';
import type { Invoice, Payment } from '../db/types';
import type { TemplateId } from '../templates/templates';

/**
 * PDF pipeline (spec §8):
 * - Generated once from the immutable snapshot at issuance.
 * - Stored privately; reprints/re-emails always use the STORED file,
 *   never a silent regeneration.
 */

async function resolveLogoUrl(snapshot: InvoiceSnapshot): Promise<string | undefined> {
  const path = snapshot.business.logo_path;
  if (!path) return undefined;
  try {
    return (await getLogoUrl(path)) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function renderInvoicePdfBlob(
  snapshot: InvoiceSnapshot,
  template: TemplateId,
  pageSize: PdfPageSize = 'LETTER',
): Promise<Blob> {
  const logoUrl = await resolveLogoUrl(snapshot);
  try {
    return await pdf(
      InvoicePdf({ snapshot, template, pageSize, logoUrl }),
    ).toBlob();
  } catch {
    // Logo fetch failures must not block issuance — retry without the logo.
    if (logoUrl) {
      return await pdf(InvoicePdf({ snapshot, template, pageSize })).toBlob();
    }
    throw new Error('Could not generate the invoice PDF.');
  }
}

/** Store the issued PDF privately and record its path on the invoice. */
export async function storeIssuedPdf(
  workspaceId: string,
  businessId: string,
  invoiceId: string,
  blob: Blob,
): Promise<string> {
  const sb = requireSupabase();
  const path = `${workspaceId}/${businessId}/${invoiceId}/issued.pdf`;
  const { error: upErr } = await sb.storage
    .from('issued-pdfs')
    .upload(path, blob, { contentType: 'application/pdf', upsert: true });
  if (upErr) throw upErr;
  const { error: dbErr } = await sb.from('invoices').update({ issued_pdf_path: path }).eq('id', invoiceId);
  if (dbErr) throw dbErr;
  return path;
}

/**
 * Ensure a stored issued PDF exists. If one is already stored, its path is
 * returned untouched (reprints never regenerate).
 */
export async function ensureIssuedPdf(
  workspaceId: string,
  invoice: Invoice,
  snapshot: InvoiceSnapshot,
  template: TemplateId,
  pageSize: PdfPageSize = 'LETTER',
): Promise<string> {
  if (invoice.issued_pdf_path) return invoice.issued_pdf_path;
  const blob = await renderInvoicePdfBlob(snapshot, template, pageSize);
  return storeIssuedPdf(workspaceId, invoice.business_id, invoice.id, blob);
}

/** Download a file from private storage with a friendly filename. */
export async function downloadStoredFile(
  bucket: 'issued-pdfs' | 'payment-receipts' | 'business-logos',
  path: string,
  filename: string,
): Promise<void> {
  const sb = requireSupabase();
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 120);
  if (error) throw error;
  const res = await fetch(data.signedUrl);
  if (!res.ok) throw new Error('Could not download the file.');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function downloadIssuedPdf(
  invoice: Invoice,
  snapshot: InvoiceSnapshot,
  workspaceId: string,
  template: TemplateId,
): Promise<void> {
  const path = await ensureIssuedPdf(workspaceId, invoice, snapshot, template);
  await downloadStoredFile('issued-pdfs', path, invoicePdfFilename(snapshot));
}

/* ---------- receipts ---------- */

export async function renderReceiptPdfBlob(
  snapshot: InvoiceSnapshot,
  payment: Payment,
  balanceCents: number,
): Promise<Blob> {
  return pdf(ReceiptPdf({ snapshot, payment, balanceCents })).toBlob();
}

export async function storeReceiptPdf(
  workspaceId: string,
  businessId: string,
  payment: Payment,
  blob: Blob,
): Promise<string> {
  const sb = requireSupabase();
  const path = `${workspaceId}/${businessId}/${payment.id}/receipt.pdf`;
  const { error: upErr } = await sb.storage
    .from('payment-receipts')
    .upload(path, blob, { contentType: 'application/pdf', upsert: true });
  if (upErr) throw upErr;
  const { error: dbErr } = await sb.from('payments').update({ receipt_path: path }).eq('id', payment.id);
  if (dbErr) throw dbErr;
  return path;
}

export async function downloadReceiptPdf(
  workspaceId: string,
  snapshot: InvoiceSnapshot,
  payment: Payment & { receipt_path?: string | null },
  balanceCents: number,
): Promise<void> {
  let path = payment.receipt_path ?? null;
  if (!path) {
    const blob = await renderReceiptPdfBlob(snapshot, payment, balanceCents);
    path = await storeReceiptPdf(workspaceId, payment.business_id, payment, blob);
  }
  await downloadStoredFile('payment-receipts', path, receiptPdfFilename(snapshot, payment));
}
