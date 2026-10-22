/**
 * The immutable issuance snapshot (version 2).
 *
 * Frozen SERVER-SIDE by the freeze_invoice_snapshot trigger on the
 * draft -> issued transition. The issued PDF, reprints, and re-emails render
 * from this object — never from live business/customer/catalog data — so
 * later edits cannot alter an issued invoice (spec §5).
 *
 * Invoices issued before migration 0018 have snapshot = null; renderers must
 * fall back to live data for those.
 */

export interface SnapshotBusiness {
  display_name: string;
  legal_name: string | null;
  header_line: string | null;
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
  company: string | null;
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

export interface SnapshotCommission {
  sale_price_cents: number;
  commission_pct: string;
  commission_amount_cents: number | null;
  processing_fee_cents: number;
  other_charge_desc: string | null;
  other_charge_cents: number;
  agent_name: string | null;
  second_agent_name: string | null;
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
}

export interface InvoiceSnapshot {
  version: 2;
  invoice_number: string | null;
  template: 'standard' | 'commission' | 'boardup';
  currency: string;
  invoice_date: string;
  due_date: string | null;
  po_number: string | null;
  service_date: string | null;
  service_period: string | null;
  business: SnapshotBusiness;
  customer: SnapshotCustomer | null;
  lines: SnapshotLine[];
  commission: SnapshotCommission;
  /** Board-Up job sheet fields (template 'boardup'); null otherwise. */
  boardup_details: Record<string, unknown> | null;
  /** When the board-up job came in (invoice created_at); null for other templates. */
  job_created_at: string | null;
  /**
   * Owner contact block printed at the end of board-up job PDFs
   * (template 'boardup' only). Null when not set.
   */
  boardup_crew_contact?: { name: string; phone: string; email: string } | null;
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
  issued_at: string;
}

/** Type guard for snapshots read back from the database. */
export function asSnapshot(raw: unknown): InvoiceSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as InvoiceSnapshot;
  if (s.version !== 2 || !s.business || !s.totals || !Array.isArray(s.lines)) return null;
  return s;
}

/**
 * Builds a share-ready snapshot for a board-up job from live form state.
 * Used by "Text + PDF" / "Save condensed PDF" so a draft job can be rendered
 * without finalizing it. Not immutable — for field sharing, not accounting.
 */
export function buildBoardUpShareSnapshot(args: {
  business: {
    display_name: string; legal_name: string | null; header_line: string | null; logo_path: string | null;
    address_line1: string | null; address_line2: string | null; city: string | null; state: string | null;
    zip: string | null; phone: string | null; email: string | null; website: string | null; tax_id: string | null;
  };
  details: Record<string, unknown>;
  jobNumber: string | null;
  invoiceDate: string;
  /** When the job came in — feeds the PDF "Date and time" line. */
  jobCreatedAt?: string | null;
  /** Owner contact block for the end of the job PDF (template 'boardup'). */
  crewContact?: { name: string; phone: string; email: string } | null;
}): InvoiceSnapshot {
  const { business, details, jobNumber, invoiceDate, jobCreatedAt, crewContact } = args;
  const snap = buildLiveSnapshot({
    invoice: {
      invoice_number: jobNumber, template: 'boardup', currency: 'USD',
      invoice_date: invoiceDate, created_at: jobCreatedAt ?? null, due_date: null, po_number: null,
      service_date: null, service_period: null,
      subtotal_cents: 0, discount_cents: 0, tax_cents: 0, tax_breakdown: [],
      shipping_cents: 0, total_cents: 0, notes: null, terms: null,
      payment_instructions_snapshot: null, payment_instructions: null,
      sale_price_cents: 0, commission_pct: '', commission_amount_cents: null,
      processing_fee_cents: 0, other_charge_desc: null, other_charge_cents: 0,
      agent_name: null, second_agent_name: null, property_address: null,
      property_city: null, property_state: null, property_zip: null,
      boardup_details: details,
      issued_at: null,
    },
    business,
    customer: null,
    lines: [],
  });
  snap.boardup_crew_contact = crewContact ?? null;
  return snap;
}

/**
 * Fallback for invoices issued before migration 0018 (snapshot = null):
 * builds the v2 shape from live data. Not immutable — but no worse than the
 * pre-0018 print view, which also rendered live data. New issuances always
 * carry the server-frozen snapshot.
 */
export function buildLiveSnapshot(args: {
  invoice: {
    invoice_number: string | null; template: 'standard' | 'commission' | 'boardup'; currency: string;
    invoice_date: string; due_date: string | null; po_number: string | null;
    service_date: string | null; service_period: string | null;
    subtotal_cents: number; discount_cents: number; tax_cents: number;
    tax_breakdown: { rate: string; cents: number }[] | null;
    shipping_cents: number; total_cents: number;
    notes: string | null; terms: string | null;
    payment_instructions_snapshot: string | null; payment_instructions: string | null;
    sale_price_cents: number; commission_pct: string; commission_amount_cents: number | null;
    processing_fee_cents: number; other_charge_desc: string | null; other_charge_cents: number;
    agent_name: string | null; second_agent_name: string | null; property_address: string | null;
    property_city: string | null; property_state: string | null; property_zip: string | null;
    boardup_details: Record<string, unknown> | null;
    issued_at: string | null;
    /** DB created_at — when the job came in (optional; boardup "Date and time" line). */
    created_at?: string | null;
  };
  business: {
    display_name: string; legal_name: string | null; header_line: string | null; logo_path: string | null;
    address_line1: string | null; address_line2: string | null; city: string | null; state: string | null;
    zip: string | null; phone: string | null; email: string | null; website: string | null; tax_id: string | null;
  };
  customer: {
    name: string; company: string | null; contact_person: string | null;
    billing_line1: string | null; billing_line2: string | null; billing_city: string | null;
    billing_state: string | null; billing_zip: string | null; email: string | null; phone: string | null;
  } | null;
  lines: {
    position: number; description: string; quantity: string; unit_label: string;
    unit_price_cents: number; discount_cents: number; tax_rate: string; line_total_cents: number;
  }[];
}): InvoiceSnapshot {
  const { invoice: inv, business: b, customer: c, lines } = args;
  return {
    version: 2,
    invoice_number: inv.invoice_number,
    template: inv.template,
    currency: inv.currency,
    invoice_date: inv.invoice_date,
    due_date: inv.due_date,
    po_number: inv.po_number,
    service_date: inv.service_date,
    service_period: inv.service_period,
    business: { ...b },
    customer: c ? { ...c } : null,
    lines: lines.map((l) => ({ ...l })),
    commission: {
      sale_price_cents: inv.sale_price_cents,
      commission_pct: inv.commission_pct,
      commission_amount_cents: inv.commission_amount_cents,
      processing_fee_cents: inv.processing_fee_cents,
      other_charge_desc: inv.other_charge_desc,
      other_charge_cents: inv.other_charge_cents,
      agent_name: inv.agent_name,
      second_agent_name: inv.second_agent_name,
      property_address: inv.property_address,
      property_city: inv.property_city,
      property_state: inv.property_state,
      property_zip: inv.property_zip,
    },
    boardup_details: inv.boardup_details ?? null,
    job_created_at: inv.created_at ?? null,
    totals: {
      subtotal_cents: inv.subtotal_cents,
      discount_cents: inv.discount_cents,
      tax_cents: inv.tax_cents,
      tax_by_rate: inv.tax_breakdown ?? [],
      shipping_cents: inv.shipping_cents,
      total_cents: inv.total_cents,
    },
    notes: inv.notes,
    terms: inv.terms,
    payment_instructions: inv.payment_instructions_snapshot ?? inv.payment_instructions,
    issued_at: inv.issued_at ?? new Date().toISOString(),
  };
}
