import { pdf } from '@react-pdf/renderer';
import { InvoicePdf, invoicePdfFilename, type PdfPageSize, type InvoiceStyle, type BoardUpPhotoItem } from './InvoicePdf';
export type { InvoiceStyle, BoardUpPhotoItem } from './InvoicePdf';
import { ReceiptPdf, receiptPdfFilename } from './ReceiptPdf';
import { requireSupabase } from '../lib/supabase';
import { fetchPhotoDateTime, formatPhotoDateTime } from '../lib/exif';
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

/** Storage paths of the board-up job photos (template 'boardup' only). */
function boardUpPhotoPaths(snapshot: InvoiceSnapshot): string[] {
  if (snapshot.template !== 'boardup') return [];
  const rec = snapshot.boardup_details;
  const paths = rec && Array.isArray(rec.photos) ? rec.photos.filter((p): p is string => typeof p === 'string') : [];
  return paths;
}

async function boardUpPhotoSignedUrl(path: string): Promise<string | null> {
  try {
    const sb = requireSupabase();
    const { data, error } = await sb.storage.from('invoice-attachments').createSignedUrl(path, 600);
    if (!error && data?.signedUrl) return data.signedUrl;
  } catch {
    /* one bad photo must not block the PDF */
  }
  return null;
}

/** EXIF capture times stored at upload (photoTakenAt), keyed by storage path. */
function storedPhotoTakenAt(snapshot: InvoiceSnapshot): Record<string, string> {
  const rec = snapshot.boardup_details;
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return {};
  const v = (rec as Record<string, unknown>).photoTakenAt;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string' && val) out[k] = val;
  }
  return out;
}

/**
 * Target dimensions for a photo embedded in a PDF, keeping the aspect ratio.
 * Pure function so the math is unit-testable.
 */
export function pdfPhotoTargetSize(width: number, height: number, maxSide = 900): { w: number; h: number } {
  const w0 = Math.max(1, Math.floor(width) || 1);
  const h0 = Math.max(1, Math.floor(height) || 1);
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  return { w: Math.max(1, Math.round(w0 * scale)), h: Math.max(1, Math.round(h0 * scale)) };
}

/**
 * Downscale a full-resolution phone photo to a compact JPEG data URL for PDF
 * embedding (4 photos/page stay crisp well under email size limits). Any
 * failure falls back to the original URL so the PDF still builds.
 *
 * Exported for the job form too: thumbnails use the same compressed image so
 * browser Print / Save-as-PDF doesn't embed full-resolution originals.
 */
export async function downscalePhotoForPdf(url: string): Promise<string> {
  try {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return url;
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('photo load failed'));
      el.src = url;
    });
    const { w, h } = pdfPhotoTargetSize(img.naturalWidth || img.width, img.naturalHeight || img.height);
    // Already small enough and a JPEG: embedding as-is is fine.
    if (w >= (img.naturalWidth || img.width) && /\.jpe?g($|\?)/i.test(url)) return url;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return url;
    ctx.drawImage(img, 0, 0, w, h);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.72));
    if (!out) return url;
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(out);
    });
  } catch {
    return url;
  }
}

export async function renderInvoicePdfBlob(
  snapshot: InvoiceSnapshot,
  style: InvoiceStyle = 'classic',
  pageSize: PdfPageSize = 'LETTER',
  photosOnly = false,
  includePhotos = true,
): Promise<Blob> {
  const logoUrl = await resolveLogoUrl(snapshot);
  const paths = boardUpPhotoPaths(snapshot);
  const stored = storedPhotoTakenAt(snapshot);
  // Capture time: prefer the EXIF read at upload; fall back to reading EXIF
  // from the original file now (covers photos uploaded before this feature).
  // The canvas downscale strips EXIF, so the fallback reads before compressing.
  let photos: BoardUpPhotoItem[] = [];
  if (includePhotos) {
    for (const path of paths) {
      const url = await boardUpPhotoSignedUrl(path);
      if (!url) continue;
      const raw = stored[path] ?? (await fetchPhotoDateTime(url));
      photos.push({ url: await downscalePhotoForPdf(url), takenAt: formatPhotoDateTime(raw), takenAtRaw: raw });
    }
  } else {
    // Job-info PDF: no images embedded, but the timeline still needs the
    // taken-at times. Use stored upload-time EXIF; fall back to reading EXIF
    // from the file (covers photos uploaded before this feature).
    for (const path of paths) {
      const raw = stored[path] ?? null;
      if (raw) {
        photos.push({ url: '', takenAt: formatPhotoDateTime(raw), takenAtRaw: raw });
        continue;
      }
      const url = await boardUpPhotoSignedUrl(path);
      const fetched = url ? await fetchPhotoDateTime(url) : null;
      photos.push({ url: '', takenAt: formatPhotoDateTime(fetched), takenAtRaw: fetched });
    }
  }
  const renderWith = async (url: string | undefined) => {
    const element = InvoicePdf({ snapshot, style, pageSize, logoUrl: url, photos, includePhotos, photosOnly });
    const instance = pdf(element);
    // Ensure the reconciler has flushed: on some Safari/React versions the
    // initial updateContainer doesn't synchronously set container.document.
    const container = (instance as unknown as { container: { document: unknown } }).container;
    if (!container.document) {
      const update = (instance as unknown as { updateContainer: (doc: unknown) => void }).updateContainer;
      update(element);
      // Yield to let the scheduler flush.
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!container.document) {
      throw new Error('PDF renderer did not produce a document.');
    }
    return instance.toBlob();
  };
  try {
    return await renderWith(logoUrl);
  } catch (firstErr) {
    // A logo fetch failure must not block issuance — retry without the logo.
    if (logoUrl) {
      try {
        return await renderWith(undefined);
      } catch (retryErr) {
        console.error('Invoice PDF render failed (with and without logo):', firstErr, retryErr);
        const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        throw new Error(`PDF render failed: ${msg}`);
      }
    } else {
      console.error('Invoice PDF render failed:', firstErr);
      const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      throw new Error(`PDF render failed: ${msg}`);
    }
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
