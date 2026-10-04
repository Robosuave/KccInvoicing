import { requireSupabase } from '../lib/supabase';
import {
  calculateInvoiceTotals,
  calculateCommissionTotals,
  multiplyQuantity,
  type CalcLine,
  type CalcResult,
} from '../lib/money';
import type { Invoice, InvoiceLine, InvoiceTemplate } from '../db/types';

export interface DraftLineInput {
  id?: string;
  item_id?: string | null;
  description: string;
  quantity: string;
  unit_label?: string;
  unit_price_cents: number;
  discount_cents?: number;
  tax_rate?: string;
}

export interface DraftInput {
  business_id: string;
  customer_id?: string | null;
  invoice_date?: string;
  due_date?: string | null;
  po_number?: string | null;
  service_date?: string | null;
  service_period?: string | null;
  currency?: string;
  invoice_discount_rate?: string;
  invoice_tax_rate?: string;
  shipping_cents?: number;
  notes?: string | null;
  terms?: string | null;
  payment_instructions?: string | null;
  template?: InvoiceTemplate;
  sale_price_cents?: number;
  commission_pct?: string;
  commission_amount_cents?: number | null;
  processing_fee_cents?: number;
  other_charge_desc?: string | null;
  other_charge_cents?: number;
  agent_name?: string | null;
  second_agent_name?: string | null;
  property_address?: string | null;
  lines: DraftLineInput[];
}

function totalsFor(input: DraftInput): CalcResult {
  if (input.template === 'commission') {
    const c = calculateCommissionTotals(
      input.sale_price_cents ?? 0,
      input.commission_pct ?? '0',
      input.processing_fee_cents ?? 0,
      input.other_charge_cents ?? 0,
      input.commission_amount_cents ?? null,
    );
    // Commission invoices have no line items, discounts, tax, or shipping.
    return {
      subtotalCents: c.commissionCents,
      lineDiscountCents: 0,
      invoiceDiscountCents: 0,
      discountCents: 0,
      taxableCents: c.commissionCents,
      taxByRate: [],
      taxCents: 0,
      shippingCents: 0,
      totalCents: c.totalCents,
    };
  }
  const calcLines: CalcLine[] = input.lines.map((l) => ({
    quantity: l.quantity,
    unitPriceCents: l.unit_price_cents,
    discountCents: l.discount_cents ?? 0,
    taxRate: l.tax_rate,
  }));
  return calculateInvoiceTotals(calcLines, {
    invoiceDiscountRate: input.invoice_discount_rate,
    invoiceTaxRate: input.invoice_tax_rate,
    shippingCents: input.shipping_cents ?? 0,
  });
}

/** Columns written for the commission template. */
function commissionColumns(input: DraftInput) {
  return {
    template: input.template ?? 'standard',
    sale_price_cents: input.sale_price_cents ?? 0,
    commission_pct: input.commission_pct ?? '0',
    commission_amount_cents: input.commission_amount_cents ?? null,
    processing_fee_cents: input.processing_fee_cents ?? 0,
    other_charge_desc: input.other_charge_desc ?? null,
    other_charge_cents: input.other_charge_cents ?? 0,
    agent_name: input.agent_name ?? null,
    second_agent_name: input.second_agent_name ?? null,
    property_address: input.property_address ?? null,
  };
}

export async function listDrafts(businessId: string): Promise<Invoice[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('invoices')
    .select('*')
    .eq('business_id', businessId)
    .eq('status', 'draft')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data as Invoice[];
}

export async function getDraft(id: string): Promise<{ invoice: Invoice; lines: InvoiceLine[] }> {
  const sb = requireSupabase();
  const { data: invoice, error: iErr } = await sb.from('invoices').select('*').eq('id', id).single();
  if (iErr) throw iErr;
  const { data: lines, error: lErr } = await sb
    .from('invoice_lines')
    .select('*')
    .eq('invoice_id', id)
    .order('position');
  if (lErr) throw lErr;
  return { invoice: invoice as Invoice, lines: (lines ?? []) as InvoiceLine[] };
}

/** Create a draft invoice with its lines and computed totals. */
export async function createDraft(input: DraftInput): Promise<Invoice> {
  const sb = requireSupabase();
  const isCommission = input.template === 'commission';
  if (!isCommission && input.lines.length === 0) throw new Error('Add at least one line item.');
  const t = totalsFor(input);

  const { data: invoice, error: iErr } = await sb
    .from('invoices')
    .insert({
      business_id: input.business_id,
      customer_id: input.customer_id ?? null,
      status: 'draft',
      invoice_date: input.invoice_date ?? new Date().toISOString().slice(0, 10),
      due_date: input.due_date ?? null,
      po_number: input.po_number ?? null,
      service_date: input.service_date ?? null,
      service_period: input.service_period ?? null,
      currency: input.currency ?? 'USD',
      subtotal_cents: t.subtotalCents,
      discount_cents: t.discountCents,
      tax_cents: t.taxCents,
      shipping_cents: t.shippingCents,
      total_cents: t.totalCents,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
      payment_instructions: input.payment_instructions ?? null,
      ...commissionColumns(input),
    })
    .select()
    .single();
  if (iErr) throw iErr;

  if (isCommission) return invoice as Invoice;

  const rows = input.lines.map((l, i) => ({
    invoice_id: (invoice as Invoice).id,
    position: i,
    item_id: l.item_id ?? null,
    description: l.description,
    quantity: l.quantity,
    unit_label: l.unit_label ?? 'each',
    unit_price_cents: l.unit_price_cents,
    discount_cents: l.discount_cents ?? 0,
    tax_rate: l.tax_rate ?? input.invoice_tax_rate ?? '0',
    line_total_cents: multiplyQuantity(l.unit_price_cents, l.quantity),
  }));
  const { error: lErr } = await sb.from('invoice_lines').insert(rows);
  if (lErr) throw lErr;
  return invoice as Invoice;
}

/**
 * Save a draft (autosave target). Replaces lines wholesale and recomputes totals.
 * Refuses to overwrite when the caller's updated_at is older than the stored one
 * (two-tab conflict guard — spec §4).
 */
export async function saveDraft(
  id: string,
  input: DraftInput,
  expectedUpdatedAt: string,
): Promise<Invoice> {
  const sb = requireSupabase();
  const { data: current, error: cErr } = await sb
    .from('invoices')
    .select('updated_at, status')
    .eq('id', id)
    .single();
  if (cErr) throw cErr;
  if ((current as { status: string }).status !== 'draft') {
    throw new Error('Only drafts can be edited. Issued invoices use the revision workflow.');
  }
  if (new Date((current as { updated_at: string }).updated_at) > new Date(expectedUpdatedAt)) {
    throw new Error('This draft was changed in another tab. Reload to merge before saving.');
  }
  const isCommission = input.template === 'commission';
  if (!isCommission && input.lines.length === 0) throw new Error('Add at least one line item.');
  const t = totalsFor(input);

  const { data: invoice, error: iErr } = await sb
    .from('invoices')
    .update({
      customer_id: input.customer_id ?? null,
      invoice_date: input.invoice_date,
      due_date: input.due_date ?? null,
      po_number: input.po_number ?? null,
      service_date: input.service_date ?? null,
      service_period: input.service_period ?? null,
      currency: input.currency ?? 'USD',
      subtotal_cents: t.subtotalCents,
      discount_cents: t.discountCents,
      tax_cents: t.taxCents,
      shipping_cents: t.shippingCents,
      total_cents: t.totalCents,
      notes: input.notes ?? null,
      terms: input.terms ?? null,
      payment_instructions: input.payment_instructions ?? null,
      ...commissionColumns(input),
    })
    .eq('id', id)
    .select()
    .single();
  if (iErr) throw iErr;

  // Commission invoices carry no line rows; clear any left from a template switch.
  const { error: dErr } = await sb.from('invoice_lines').delete().eq('invoice_id', id);
  if (dErr) throw dErr;
  if (isCommission) return invoice as Invoice;
  const rows = input.lines.map((l, i) => ({
    invoice_id: id,
    position: i,
    item_id: l.item_id ?? null,
    description: l.description,
    quantity: l.quantity,
    unit_label: l.unit_label ?? 'each',
    unit_price_cents: l.unit_price_cents,
    discount_cents: l.discount_cents ?? 0,
    tax_rate: l.tax_rate ?? input.invoice_tax_rate ?? '0',
    line_total_cents: multiplyQuantity(l.unit_price_cents, l.quantity),
  }));
  const { error: lErr } = await sb.from('invoice_lines').insert(rows);
  if (lErr) throw lErr;
  return invoice as Invoice;
}

export async function deleteDraft(id: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from('invoices').delete().eq('id', id).eq('status', 'draft');
  if (error) throw error;
}

/** Live totals preview without touching the database. */
export function previewTotals(input: DraftInput) {
  return totalsFor(input);
}
