import { pdf } from '@react-pdf/renderer';
import { InvoicePdf, invoicePdfFilename, type PdfPageSize, type InvoiceStyle } from './InvoicePdf';
export type { InvoiceStyle } from './InvoicePdf';
import { ReceiptPdf, receiptPdfFilename } from './ReceiptPdf';
import { requireSupabase } from '../lib/supabase';
import { getInvoice } from '../data/invoices';
import { getBusiness } from '../data/businesses';
import { getCustomer } from '../data/customers';
import { asSnapshot, buildLiveSnapshot } from '../lib/snapshot';
import { getLogoUrl } from '../data/businesses';
import type { InvoiceSnapshot } from '../lib/snapshot';
import type { Invoice, Payment } from '../db/types';

/**
 * PDF pipeline (spec §8):
 * - Rendered from the immutable issuance snapshot (frozen server-side).
 * - Generated once at issuance, stored privately; reprints and downloads
 *   always use the STORED file, never a silent regeneration.
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
  style: InvoiceStyle = 'classic',
  pageSize: PdfPageSize = 'LETTER',
): Promise<Blob> {
  const logoUrl = await resolveLogoUrl(snapshot);
  try {
    return await pdf(InvoicePdf({ snapshot, style, pageSize, logoUrl })).toBlob();
  } catch (firstErr) {
    // A logo fetch failure must not block issuance — retry without the logo.
    if (logoUrl) {
      try {
        return await pdf(InvoicePdf({ snapshot, style, pageSize })).toBlob();
      } catch (retryErr) {
        console.error('Invoice PDF render failed (with and without logo):', firstErr, retryErr);
      }
    } else {
      console.error('Invoice PDF render failed:', firstErr);
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
  style: InvoiceStyle = 'classic',
): Promise<string> {
  if (invoice.issued_pdf_path) return invoice.issued_pdf_path;
  const blob = await renderInvoicePdfBlob(snapshot, style);
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
  style: InvoiceStyle = 'classic',
): Promise<void> {
  const path = await ensureIssuedPdf(workspaceId, invoice, snapshot, style);
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
  payment: Payment,
  balanceCents: number,
): Promise<void> {
  let path = payment.receipt_path ?? null;
  if (!path) {
    const blob = await renderReceiptPdfBlob(snapshot, payment, balanceCents);
    path = await storeReceiptPdf(workspaceId, payment.business_id, payment, blob);
  }
  await downloadStoredFile('payment-receipts', path, receiptPdfFilename(snapshot, payment));
}

/**
 * Generate and privately store the issued PDF for an invoice, from its
 * server-frozen snapshot (live-data fallback for pre-0018 invoices).
 * Best-effort: throws on failure so callers can surface a retry.
 */
export async function generateAndStoreIssuedPdf(
  workspaceId: string,
  invoiceId: string,
  style: InvoiceStyle = 'classic',
): Promise<string> {
  const { invoice, lines } = await getInvoice(invoiceId);
  if (invoice.status !== 'issued') throw new Error('Invoice is not issued.');
  let snapshot = asSnapshot(invoice.snapshot);
  if (!snapshot) {
    const business = await getBusiness(invoice.business_id);
    const customer = invoice.customer_id
      ? await getCustomer(invoice.customer_id).catch(() => null)
      : null;
    snapshot = buildLiveSnapshot({ invoice, business, customer, lines });
  }
  const blob = await renderInvoicePdfBlob(snapshot, style);
  return storeIssuedPdf(workspaceId, invoice.business_id, invoice.id, blob);
}
