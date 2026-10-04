import { describe, expect, it } from 'vitest';
import { isOverdue } from '../data/invoices';
import { asSnapshot, buildLiveSnapshot } from '../lib/snapshot';
import { invoicePdfFilename } from '../pdf/InvoicePdf';
import { receiptPdfFilename } from '../pdf/ReceiptPdf';
import { paymentStatusOf, type Invoice, type Payment } from '../db/types';

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'i1',
    business_id: 'b1',
    customer_id: 'c1',
    status: 'issued',
    invoice_number: 'KC-42',
    created_by: null,
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
    template: 'standard',
    sale_price_cents: 0,
    commission_pct: '0',
    commission_amount_cents: null,
    processing_fee_cents: 0,
    other_charge_desc: null,
    other_charge_cents: 0,
    agent_name: null,
    second_agent_name: null,
    property_address: null,
    notes: null,
    terms: null,
    payment_instructions: null,
    payment_instructions_snapshot: null,
    snapshot: null,
    issued_at: '2026-10-01T12:00:00Z',
    voided_at: null,
    void_reason: null,
    revision_of: null,
    revision_no: 1,
    issued_pdf_path: null,
    tax_breakdown: [{ rate: '0.06', cents: 1200 }],
    created_at: '',
    updated_at: '',
    ...overrides,
  } as Invoice;
}

describe('paymentStatusOf', () => {
  it('derives unpaid / partial / paid from totals', () => {
    expect(paymentStatusOf(21200, 0)).toBe('unpaid');
    expect(paymentStatusOf(21200, 12000)).toBe('partial');
    expect(paymentStatusOf(21200, 21200)).toBe('paid');
  });
});

describe('isOverdue', () => {
  it('flags issued invoices with a balance past their due date', () => {
    expect(isOverdue(invoice(), '2026-10-20')).toBe(true);
  });
  it('ignores paid, draft, and void invoices', () => {
    expect(isOverdue(invoice({ amount_paid_cents: 21200 }), '2026-10-20')).toBe(false);
    expect(isOverdue(invoice({ status: 'draft' }), '2026-10-20')).toBe(false);
    expect(isOverdue(invoice({ status: 'void' }), '2026-10-20')).toBe(false);
  });
  it('ignores invoices without a due date or not yet due', () => {
    expect(isOverdue(invoice({ due_date: null }), '2026-10-20')).toBe(false);
    expect(isOverdue(invoice(), '2026-10-10')).toBe(false);
  });
});

describe('asSnapshot', () => {
  it('rejects null, wrong versions, and malformed snapshots', () => {
    expect(asSnapshot(null)).toBeNull();
    expect(asSnapshot({ version: 1 })).toBeNull();
    expect(asSnapshot({ version: 2 })).toBeNull();
  });
  it('accepts a well-formed v2 snapshot', () => {
    const snap = buildLiveSnapshot({
      invoice: invoice(),
      business: {
        display_name: 'Biz', legal_name: null, header_line: null, logo_path: null,
        address_line1: null, address_line2: null, city: null, state: null, zip: null,
        phone: null, email: null, website: null, tax_id: null,
      },
      customer: null,
      lines: [],
    });
    expect(asSnapshot(snap)?.version).toBe(2);
    expect(asSnapshot(snap)?.totals.total_cents).toBe(21200);
    expect(asSnapshot(snap)?.totals.tax_by_rate).toEqual([{ rate: '0.06', cents: 1200 }]);
  });
});

describe('buildLiveSnapshot', () => {
  it('carries commission fields for commission invoices', () => {
    const inv = invoice({
      template: 'commission',
      sale_price_cents: 50000000,
      commission_pct: '3',
      commission_amount_cents: null,
      processing_fee_cents: 29500,
      other_charge_desc: 'HOA',
      other_charge_cents: 15000,
      agent_name: 'Jane Agent',
      property_address: '123 Main St',
      subtotal_cents: 1500000,
      total_cents: 1544500,
      tax_breakdown: [],
    });
    const snap = buildLiveSnapshot({
      invoice: inv,
      business: {
        display_name: 'Dania Realty Inc', legal_name: null, header_line: null, logo_path: null,
        address_line1: null, address_line2: null, city: null, state: null, zip: null,
        phone: null, email: null, website: null, tax_id: null,
      },
      customer: null,
      lines: [],
    });
    expect(snap.template).toBe('commission');
    expect(snap.commission.property_address).toBe('123 Main St');
    expect(snap.commission.agent_name).toBe('Jane Agent');
    expect(snap.totals.total_cents).toBe(1544500);
  });
  it('prefers the frozen payment-instructions snapshot', () => {
    const inv = invoice({
      payment_instructions: 'NEW instructions',
      payment_instructions_snapshot: 'FROZEN instructions',
    });
    const snap = buildLiveSnapshot({
      invoice: inv,
      business: {
        display_name: 'Biz', legal_name: null, header_line: null, logo_path: null,
        address_line1: null, address_line2: null, city: null, state: null, zip: null,
        phone: null, email: null, website: null, tax_id: null,
      },
      customer: null,
      lines: [],
    });
    expect(snap.payment_instructions).toBe('FROZEN instructions');
  });
});

describe('PDF filenames', () => {
  const snap = buildLiveSnapshot({
    invoice: invoice(),
    business: {
      display_name: 'Biz', legal_name: null, header_line: null, logo_path: null,
      address_line1: null, address_line2: null, city: null, state: null, zip: null,
      phone: null, email: null, website: null, tax_id: null,
    },
    customer: { name: 'Acme Co.', company: null, contact_person: null, billing_line1: null, billing_line2: null, billing_city: null, billing_state: null, billing_zip: null, email: null, phone: null },
    lines: [],
  });
  it('builds a safe descriptive invoice filename', () => {
    expect(invoicePdfFilename(snap)).toBe('Invoice-KC-42-Acme-Co.pdf');
  });
  it('strips unsafe characters from the number', () => {
    expect(invoicePdfFilename({ ...snap, invoice_number: 'KC/42 ".."' })).toBe('Invoice-KC-42-Acme-Co.pdf');
  });
  it('builds a receipt filename', () => {
    const payment = { id: 'p1', payment_date: '2026-10-05' } as Payment;
    expect(receiptPdfFilename(snap, payment)).toBe('Receipt-KC-42-2026-10-05.pdf');
  });
});
