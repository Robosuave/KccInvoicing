import { requireSupabase } from '../lib/supabase';
import { logAuditEvent } from './audit';
import { getDraft } from './drafts';
import { createDraft } from './drafts';
import type { Invoice, InvoiceStatus, PaymentStatus } from '../db/types';

export interface InvoiceFilters {
  search?: string;
  status?: InvoiceStatus | 'all';
  paymentStatus?: PaymentStatus | 'all';
  overdue?: boolean;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'invoice_date' | 'invoice_number' | 'total_cents' | 'created_at';
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface InvoiceRow extends Invoice {
  customer_name?: string | null;
}

const DEFAULT_PAGE_SIZE = 25;

export async function listInvoices(
  businessId: string,
  f: InvoiceFilters = {},
): Promise<{ rows: InvoiceRow[]; total: number }> {
  const sb = requireSupabase();
  const page = f.page ?? 0;
  const pageSize = f.pageSize ?? DEFAULT_PAGE_SIZE;
  const sortBy = f.sortBy ?? 'invoice_date';
  const sortDir = f.sortDir ?? 'desc';

  let q = sb
    .from('invoices')
    .select('*, customers(name)', { count: 'exact' })
    .eq('business_id', businessId);

  if (f.status && f.status !== 'all') q = q.eq('status', f.status);
  if (f.paymentStatus && f.paymentStatus !== 'all') q = q.eq('payment_status', f.paymentStatus);
  if (f.overdue) {
    const today = new Date().toISOString().slice(0, 10);
    q = q.eq('status', 'issued').neq('payment_status', 'paid').lt('due_date', today);
  }
  if (f.dateFrom) q = q.gte('invoice_date', f.dateFrom);
  if (f.dateTo) q = q.lte('invoice_date', f.dateTo);
  if (f.search?.trim()) {
    const s = f.search.trim();
    // number, PO, notes, or customer name
    q = q.or(
      `invoice_number.ilike.%${s}%,po_number.ilike.%${s}%,notes.ilike.%${s}%,draft_key.ilike.%${s}%`,
    );
  }

  q = q.order(sortBy, { ascending: sortDir === 'asc' }).range(page * pageSize, (page + 1) * pageSize - 1);

  const { data, error, count } = await q;
  if (error) throw error;

  let rows = ((data ?? []) as unknown as (Invoice & { customers: { name: string } | null })[]).map((r) => ({
    ...r,
    customer_name: r.customers?.name ?? null,
    customers: undefined,
  })) as InvoiceRow[];

  // Customer-name search needs a second pass (RLS-safe, small result sets in v1).
  if (f.search?.trim()) {
    const s = f.search.trim().toLowerCase();
    const { data: cdata } = await sb
      .from('customers')
      .select('id, name')
      .eq('business_id', businessId)
      .ilike('name', `%${f.search.trim()}%`);
    const ids = new Set((cdata ?? []).map((c) => (c as { id: string }).id));
    if (ids.size > 0) {
      const { data: extra } = await sb
        .from('invoices')
        .select('*, customers(name)')
        .eq('business_id', businessId)
        .in('customer_id', [...ids])
        .order(sortBy, { ascending: sortDir === 'asc' });
      const seen = new Set(rows.map((r) => r.id));
      for (const r of (extra ?? []) as unknown as (Invoice & { customers: { name: string } | null })[]) {
        if (!seen.has(r.id)) {
          rows.push({ ...r, customer_name: r.customers?.name ?? null } as InvoiceRow);
          seen.add(r.id);
        }
      }
      void s;
    }
  }

  return { rows, total: count ?? rows.length };
}

export async function getIssuedInvoice(id: string): Promise<Invoice> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('invoices').select('*').eq('id', id).single();
  if (error) throw error;
  const inv = data as Invoice;
  if (inv.status === 'draft') throw new Error('This invoice is still a draft.');
  return inv;
}

/** Void an issued invoice. The number is never reused. */
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
 * Start a correction: copies an issued/void invoice into a new draft linked to
 * the original. The original is preserved untouched; the revision history
 * shows the chain. Issuing the revision does not alter the original.
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
    invoice_date: new Date().toISOString().slice(0, 10),
    due_date: original.due_date,
    po_number: original.po_number,
    service_date: original.service_date,
    service_period: original.service_period,
    currency: original.currency,
    shipping_cents: original.shipping_cents,
    notes: original.notes,
    terms: original.terms,
    payment_instructions: original.payment_instructions,
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
    .update({ revised_from_id: issuedId, revision_no: original.revision_no + 1 })
    .eq('id', draft.id);

  await logAuditEvent(original.business_id, issuedId, 'revision_started', {
    reason: reason.trim(),
    revision_draft_id: draft.id,
    revision_no: original.revision_no + 1,
  });

  return draft.id;
}

/** Full revision chain for an invoice, oldest first. */
export async function listRevisionChain(invoiceId: string): Promise<Invoice[]> {
  const sb = requireSupabase();
  // Walk up to the root, then down. v1: simple two-level lookup.
  const { data: inv, error } = await sb.from('invoices').select('*').eq('id', invoiceId).single();
  if (error) throw error;
  const root = (inv as Invoice).revised_from_id ?? invoiceId;
  const { data: chain, error: cErr } = await sb
    .from('invoices')
    .select('*')
    .or(`id.eq.${root},revised_from_id.eq.${root}`)
    .order('revision_no', { ascending: true });
  if (cErr) throw cErr;
  return (chain ?? []) as Invoice[];
}

/** Overdue = issued, has a balance, past due date. */
export function isOverdue(inv: Invoice, today = new Date().toISOString().slice(0, 10)): boolean {
  return (
    inv.status === 'issued' &&
    inv.payment_status !== 'paid' &&
    !!inv.due_date &&
    inv.due_date < today
  );
}
