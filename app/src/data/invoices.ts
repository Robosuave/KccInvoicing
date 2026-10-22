import { requireSupabase } from '../lib/supabase';
import { logAuditEvent } from './audit';
import { createDraft, getDraft } from './drafts';
import type { Invoice, InvoiceLine } from '../db/types';

export async function getInvoice(id: string): Promise<{ invoice: Invoice; lines: InvoiceLine[] }> {
  return getDraft(id); // reads invoice + lines for any status
}

export interface InvoiceHistoryFilters {
  search?: string;
  status?: 'all' | 'draft' | 'issued' | 'void';
  overdue?: boolean;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Full invoice history with search, filters, and pagination.
 * (drafts.ts listInvoices covers the simple tab-filtered case.)
 */
export async function listInvoiceHistory(
  businessId: string,
  f: InvoiceHistoryFilters = {},
): Promise<{ rows: Invoice[]; total: number }> {
  const sb = requireSupabase();
  const page = f.page ?? 0;
  const pageSize = f.pageSize ?? 25;

  let q = sb
    .from('invoices')
    .select('*', { count: 'exact' })
    .eq('business_id', businessId);

  if (f.status && f.status !== 'all') q = q.eq('status', f.status);
  if (f.overdue) {
    const today = new Date().toISOString().slice(0, 10);
    q = q.eq('status', 'issued').lt('due_date', today);
    // balance > 0: amount_paid_cents < total_cents — expressed via filter below
  }
  if (f.dateFrom) q = q.gte('invoice_date', f.dateFrom);
  if (f.dateTo) q = q.lte('invoice_date', f.dateTo);
  if (f.search?.trim()) {
    const s = f.search.trim().replace(/[%_]/g, '');
    q = q.or(`invoice_number.ilike.%${s}%,po_number.ilike.%${s}%,notes.ilike.%${s}%,property_address.ilike.%${s}%`);
  }

  q = q.order('invoice_date', { ascending: false }).range(page * pageSize, (page + 1) * pageSize - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  let rows = (data ?? []) as Invoice[];
  if (f.overdue) rows = rows.filter((r) => r.amount_paid_cents < r.total_cents);
  return { rows, total: count ?? rows.length };
}

/** Void an issued invoice. Owner-only in the UI; the number is never reused. */
export async function voidInvoice(id: string, reason: string): Promise<Invoice> {
  const sb = requireSupabase();
  if (!reason.trim()) throw new Error('A reason is required to void an invoice.');
  const { data: current, error: gErr } = await sb.from('invoices').select('*').eq('id', id).single();
  if (gErr) throw gErr;
  const inv = current as Invoice;
  if (inv.status !== 'issued') throw new Error('Only issued invoices can be voided.');

  const { data, error } = await sb
    .from('invoices')
    .update({ status: 'void', voided_at: new Date().toISOString(), void_reason: reason.trim() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;

  await logAuditEvent(inv.business_id, id, 'voided', {
    invoice_number: inv.invoice_number,
    reason: reason.trim(),
  });
  return data as Invoice;
}

/**
 * Permanently deletes an invoice/job and its stored files (issued PDF,
 * board-up photos). Owner-only in the UI; RLS has an invoices member-delete
 * policy. This cannot be undone — callers must confirm first.
 */
export async function deleteInvoiceDeep(id: string): Promise<void> {
  const sb = requireSupabase();
  const { data: current, error: gErr } = await sb
    .from('invoices')
    .select('id, business_id, invoice_number, issued_pdf_path, template, boardup_details')
    .eq('id', id)
    .single();
  if (gErr) throw gErr;
  const inv = current as {
    id: string; business_id: string; invoice_number: string | null;
    issued_pdf_path: string | null; template: string; boardup_details: unknown;
  };

  // Best-effort file cleanup: a missing file must not block the delete.
  const photoPaths: string[] = [];
  if (inv.template === 'boardup' && inv.boardup_details && typeof inv.boardup_details === 'object') {
    const photos = (inv.boardup_details as { photos?: unknown }).photos;
    if (Array.isArray(photos)) {
      for (const p of photos) if (typeof p === 'string' && p) photoPaths.push(p);
    }
  }
  if (photoPaths.length > 0) {
    try {
      await sb.storage.from('invoice-attachments').remove(photoPaths);
    } catch {
      /* ignore — row delete still proceeds */
    }
  }
  if (inv.issued_pdf_path) {
    try {
      await sb.storage.from('issued-pdfs').remove([inv.issued_pdf_path]);
    } catch {
      /* ignore */
    }
  }

  const { error: dErr } = await sb.from('invoices').delete().eq('id', id);
  if (dErr) throw dErr;

  await logAuditEvent(inv.business_id, id, 'deleted', {
    invoice_number: inv.invoice_number,
    template: inv.template,
  });
}

/**
 * Start a correction: copies an issued/void invoice into a new draft linked to
 * the original. The original is preserved untouched. Numbers are assigned fresh
 * at creation (never reused).
 */
export async function createRevision(issuedId: string, reason: string): Promise<string> {
  if (!reason.trim()) throw new Error('A reason is required to start a revision.');
  const sb = requireSupabase();
  const { data: current, error: gErr } = await sb.from('invoices').select('*').eq('id', issuedId).single();
  if (gErr) throw gErr;
  const original = current as Invoice;
  if (original.status === 'draft') throw new Error('Drafts are edited directly — no revision needed.');

  const { lines } = await getDraft(issuedId);
  const draft = await createDraft({
    business_id: original.business_id,
    customer_id: original.customer_id,
    // A revision is the same job — keep the original job date, not today.
    invoice_date: original.invoice_date,
    currency: original.currency,
    notes: original.notes,
    terms: original.terms,
    template: original.template,
    sale_price_cents: original.sale_price_cents,
    commission_pct: original.commission_pct,
    commission_amount_cents: original.commission_amount_cents,
    processing_fee_cents: original.processing_fee_cents,
    other_charge_desc: original.other_charge_desc,
    other_charge_cents: original.other_charge_cents,
    agent_name: original.agent_name,
    second_agent_name: original.second_agent_name,
    property_address: original.property_address,
    // Board-up jobs carry all their data (fields, photos, photo times) in
    // boardup_details — a revision must copy it, or the draft comes out blank.
    boardup_details: (original as { boardup_details?: Record<string, unknown> | null }).boardup_details ?? null,
    lines: lines.map((l) => ({
      item_id: l.item_id,
      description: l.description,
      quantity: l.quantity,
      unit_label: l.unit_label,
      unit_price_cents: l.unit_price_cents,
      discount_cents: l.discount_cents,
      tax_rate: l.tax_rate,
    })),
  });

  await sb
    .from('invoices')
    .update({
      revision_of: issuedId,
      revision_no: original.revision_no + 1,
      // "First input" on the timeline is the job's created_at — a revision is
      // the same job, so carry the original time forward. Otherwise the
      // timeline shows the revision's creation time and the time-to-job-site
      // math goes negative and hides.
      created_at: (original as { created_at?: string }).created_at ?? undefined,
    })
    .eq('id', draft.id);

  await logAuditEvent(original.business_id, issuedId, 'revision_started', {
    reason: reason.trim(),
    revision_draft_id: draft.id,
    revision_no: original.revision_no + 1,
  });

  return draft.id;
}

/** Revision chain for an invoice, oldest first. */
export async function listRevisionChain(invoiceId: string): Promise<Invoice[]> {
  const sb = requireSupabase();
  const { data: inv, error } = await sb.from('invoices').select('*').eq('id', invoiceId).single();
  if (error) throw error;
  const root = (inv as Invoice).revision_of ?? invoiceId;
  const { data: chain, error: cErr } = await sb
    .from('invoices')
    .select('*')
    .or(`id.eq.${root},revision_of.eq.${root}`)
    .order('revision_no', { ascending: true });
  if (cErr) throw cErr;
  return (chain ?? []) as Invoice[];
}

/** Overdue = issued, has a balance, past due date. */
export function isOverdue(inv: Invoice, today = new Date().toISOString().slice(0, 10)): boolean {
  return (
    inv.status === 'issued' &&
    inv.amount_paid_cents < inv.total_cents &&
    !!inv.due_date &&
    inv.due_date < today
  );
}
