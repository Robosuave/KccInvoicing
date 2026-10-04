/**
 * The immutable issuance snapshot.
 *
 * Written once, atomically with the invoice number, at issuance. The invoice
 * detail page, the PDF, and the print view all render from this object — never
 * from live business/customer/catalog data — so later edits cannot alter an
 * issued invoice (spec §5).
 */
import type { Business, Customer, Invoice, InvoiceLine } from '../db/types';
import { calculateInvoiceTotals, type CalcLine } from './money';

export interface SnapshotBusiness {
  display_name: string;
  legal_name: string | null;
  logo_path: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  tax_id: string | null;
}

export interface SnapshotCustomer {
  name: string;
  contact_person: string | null;
  billing_line1: string | null;
  billing_line2: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_zip: string | null;
  email: string | null;
  phone: string | null;
}

export interface SnapshotLine {
  position: number;
  description: string;
  quantity: string;
  unit_label: string;
  unit_price_cents: number;
  discount_cents: number;
  tax_rate: string;
  line_total_cents: number;
}

export interface InvoiceSnapshot {
  version: 1;
  invoice_number: string; // filled by the issuance RPC; '' at build time
  template_id: string;
  currency: string;
  invoice_date: string;
  due_date: string | null;
  po_number: string | null;
  service_date: string | null;
  service_period: string | null;
  business: SnapshotBusiness;
  customer: SnapshotCustomer | null;
  lines: SnapshotLine[];
  totals: {
    subtotal_cents: number;
    discount_cents: number;
    tax_cents: number;
    tax_by_rate: { rate: string; cents: number }[];
    shipping_cents: number;
    total_cents: number;
  };
  notes: string | null;
  terms: string | null;
  payment_instructions: string | null;
  issued_at: string; // filled by the issuance RPC; '' at build time
}

export function buildSnapshot(
  invoice: Invoice,
  lines: InvoiceLine[],
  business: Business,
  customer: Customer | null,
  templateId: string,
): InvoiceSnapshot {
  const calcLines: CalcLine[] = lines.map((l) => ({
    quantity: l.quantity,
    unitPriceCents: l.unit_price_cents,
    discountCents: l.discount_cents,
    taxRate: l.tax_rate,
  }));
  const t = calculateInvoiceTotals(calcLines, { shippingCents: invoice.shipping_cents });

  // Integrity check: the snapshot must reproduce the stored totals exactly.
  if (
    t.subtotalCents !== invoice.subtotal_cents ||
    t.discountCents !== invoice.discount_cents ||
    t.taxCents !== invoice.tax_cents ||
    t.totalCents !== invoice.total_cents
  ) {
    throw new Error(
      'Invoice totals changed since the draft was saved. Re-open and re-save the draft before issuing.',
    );
  }

  return {
    version: 1,
    invoice_number: invoice.invoice_number ?? '',
    template_id: templateId,
    currency: invoice.currency,
    invoice_date: invoice.invoice_date,
    due_date: invoice.due_date,
    po_number: invoice.po_number,
    service_date: invoice.service_date,
    service_period: invoice.service_period,
    business: {
      display_name: business.display_name,
      legal_name: business.legal_name,
      logo_path: business.logo_path,
      address_line1: business.address_line1,
      address_line2: business.address_line2,
      city: business.city,
      state: business.state,
      zip: business.zip,
      phone: business.phone,
      email: business.email,
      website: business.website,
      tax_id: business.tax_id,
    },
    customer: customer
      ? {
          name: customer.name,
          contact_person: customer.contact_person,
          billing_line1: customer.billing_line1,
          billing_line2: customer.billing_line2,
          billing_city: customer.billing_city,
          billing_state: customer.billing_state,
          billing_zip: customer.billing_zip,
          email: customer.email,
          phone: customer.phone,
        }
      : null,
    lines: lines.map((l) => ({
      position: l.position,
      description: l.description,
      quantity: l.quantity,
      unit_label: l.unit_label,
      unit_price_cents: l.unit_price_cents,
      discount_cents: l.discount_cents,
      tax_rate: l.tax_rate,
      line_total_cents: l.line_total_cents,
    })),
    totals: {
      subtotal_cents: t.subtotalCents,
      discount_cents: t.discountCents,
      tax_cents: t.taxCents,
      tax_by_rate: t.taxByRate,
      shipping_cents: t.shippingCents,
      total_cents: t.totalCents,
    },
    notes: invoice.notes,
    terms: invoice.terms,
    payment_instructions: invoice.payment_instructions,
    issued_at: invoice.issued_at ?? '',
  };
}

/** Type guard for snapshots read back from the database. */
export function asSnapshot(raw: unknown): InvoiceSnapshot {
  const s = raw as InvoiceSnapshot;
  if (!s || s.version !== 1 || !Array.isArray(s.lines) || !s.business || !s.totals) {
    throw new Error('Stored invoice snapshot is missing or corrupt.');
  }
  return s;
}
