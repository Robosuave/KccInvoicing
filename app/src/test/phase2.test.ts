import { describe, expect, it } from 'vitest';
import { isOverdue } from '../data/invoices';
import { previewNextNumber } from '../data/issuance';
import { buildSnapshot } from '../lib/snapshot';
import { invoicePdfFilename } from '../pdf/InvoicePdf';
import { receiptPdfFilename } from '../pdf/ReceiptPdf';
import type { Business, Customer, Invoice, InvoiceLine, Payment } from '../db/types';

const business = {
  id: 'b1',
  workspace_id: 'w1',
  display_name: 'Kaleky Computer Consulting Inc',
  legal_name: null,
  logo_path: null,
  address_line1: '2800 N 46th Ave',
  address_line2: 'A608',
  city: 'Hollywood',
  state: 'FL',
  zip: '33021',
  phone: '954-555-0100',
  email: 'info@example.com',
  website: null,
  tax_id: null,
  currency: 'USD',
  payment_terms: 'Due upon receipt',
  invoice_notes: null,
  payment_instructions: null,
  invoice_prefix: 'KC-',
  next_number: 42,
  default_tax_rate: '0',
  default_email_subject: null,
  default_email_message: null,
  default_template_id: 'classic',
  archived_at: null,
  created_at: '',
  updated_at: '',
} as Business;

const customer = {
  id: 'c1',
  business_id: 'b1',
  name: 'Acme Co.',
  contact_person: null,
  billing_line1: '1 Main St',
  billing_line2: null,
  billing_city: 'Hollywood',
  billing_state: 'FL',
  billing_zip: '33021',
  email: null,
  phone: null,
  shipping_line1: null,
  shipping_line2: null,
  shipping_city: null,
  shipping_state: null,
  shipping_zip: null,
  notes: null,
  default_payment_terms: null,
  tax_exempt: false,
  archived_at: null,
  created_at: '',
  updated_at: '',
} as Customer;

function draftInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'i1',
    business_id: 'b1',
    customer_id: 'c1',
    status: 'draft',
    invoice_number: null,
    draft_key: 'draft-abc',
    invoice_date: '2026-10-01',
    due_date: '2026-10-15',
    po_number: null,
    service_date: null,
    service_period: null,
    currency: 'USD',
    subtotal_cents: 20000,
    discount_cents: 0,
    tax_cents: 1200,
    shipping_cents: 0,
    total_cents: 21200,
    amount_paid_cents: 0,
    payment_status: 'unpaid',
    notes: null,
    terms: 'Due upon receipt',
    payment_instructions: null,
    snapshot: null,
    issued_at: null,
    revised_from_id: null,
    revision_no: 1,
    voided_at: null,
    void_reason: null,
    issued_pdf_path: null,
    template_id: 'classic',
    created_at: '',
    updated_at: '',
    ...overrides,
  } as Invoice;
}

const lines = [
  {
    id: 'l1', invoice_id: 'i1', position: 0, item_id: null,
    description: 'Consulting', quantity: '2', unit_label: 'hours',
    unit_price_cents: 7500, discount_cents: 0, tax_rate: '0.06', line_total_cents: 15000,
    created_at: '',
  },
  {
    id: 'l2', invoice_id: 'i1', position: 1, item_id: null,
    description: 'Parts', quantity: '1', unit_label: 'each',
    unit_price_cents: 5000, discount_cents: 0, tax_rate: '0.06', line_total_cents: 5000,
    created_at: '',
  },
] as InvoiceLine[];

describe('previewNextNumber', () => {
  it('combines prefix and next number', () => {
    expect(previewNextNumber(business)).toBe('KC-42');
  });
  it('works with an empty prefix', () => {
    expect(previewNextNumber({ ...business, invoice_prefix: '' })).toBe('42');
  });
});

describe('buildSnapshot', () => {
  it('reproduces stored totals exactly', () => {
    const snap = buildSnapshot(draftInvoice(), lines, business, customer, 'modern');
    expect(snap.version).toBe(1);
    expect(snap.template_id).toBe('modern');
    expect(snap.totals.total_cents).toBe(21200);
    expect(snap.business.display_name).toBe('Kaleky Computer Consulting Inc');
    expect(snap.customer?.name).toBe('Acme Co.');
    expect(snap.lines).toHaveLength(2);
  });
  it('refuses to snapshot when totals drifted', () => {
    const drifted = draftInvoice({ total_cents: 21100 });
    expect(() => buildSnapshot(drifted, lines, business, customer, 'classic')).toThrow(/totals changed/);
  });
  it('allows a null customer', () => {
    const snap = buildSnapshot(draftInvoice(), lines, business, null, 'classic');
    expect(snap.customer).toBeNull();
  });
});

describe('isOverdue', () => {
  it('flags issued, unpaid, past-due invoices', () => {
    expect(isOverdue(draftInvoice({ status: 'issued' }), '2026-10-20')).toBe(true);
  });
  it('ignores paid invoices', () => {
    expect(
      isOverdue(draftInvoice({ status: 'issued', payment_status: 'paid', amount_paid_cents: 19080 }), '2026-10-20'),
    ).toBe(false);
  });
  it('ignores drafts and void invoices', () => {
    expect(isOverdue(draftInvoice({ status: 'draft' }), '2026-10-20')).toBe(false);
    expect(isOverdue(draftInvoice({ status: 'void' }), '2026-10-20')).toBe(false);
  });
  it('ignores invoices without a due date or not yet due', () => {
    expect(isOverdue(draftInvoice({ status: 'issued', due_date: null }), '2026-10-20')).toBe(false);
    expect(isOverdue(draftInvoice({ status: 'issued' }), '2026-10-10')).toBe(false);
  });
});

describe('PDF filenames', () => {
  const snap = buildSnapshot(draftInvoice(), lines, business, customer, 'classic');
  const numbered = { ...snap, invoice_number: 'KC-42' };
  it('builds a safe descriptive invoice filename', () => {
    expect(invoicePdfFilename(numbered)).toBe('Invoice-KC-42-Acme-Co.pdf');
  });
  it('strips unsafe characters', () => {
    const weird = { ...numbered, invoice_number: 'KC/42 ".."' };
    expect(invoicePdfFilename(weird)).toBe('Invoice-KC-42-Acme-Co.pdf');
  });
  it('builds a receipt filename', () => {
    const payment = { id: 'p1', payment_date: '2026-10-05' } as Payment;
    expect(receiptPdfFilename(numbered, payment)).toBe('Receipt-KC-42-2026-10-05.pdf');
  });
});
