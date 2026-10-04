/** Database row types matching supabase/migrations/0001_phase1.sql */

export interface Workspace {
  id: string;
  name: string;
  created_at: string;
}

export interface Business {
  id: string;
  workspace_id: string;
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
  currency: string;
  payment_terms: string;
  invoice_notes: string | null;
  payment_instructions: string | null;
  invoice_prefix: string;
  next_number: number;
  default_tax_rate: string; // numeric from Postgres
  default_template: InvoiceTemplate;
  default_email_subject: string | null;
  default_email_message: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  business_id: string;
  name: string;
  contact_person: string | null;
  billing_line1: string | null;
  billing_line2: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_zip: string | null;
  email: string | null;
  phone: string | null;
  shipping_line1: string | null;
  shipping_line2: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_zip: string | null;
  notes: string | null;
  default_payment_terms: string | null;
  tax_exempt: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Item {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  item_code: string | null;
  unit_label: string;
  default_rate_cents: number;
  default_tax_rate: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type InvoiceStatus = 'draft' | 'issued' | 'void';

export type InvoiceTemplate = 'standard' | 'commission';

export interface Invoice {
  id: string;
  business_id: string;
  customer_id: string | null;
  status: InvoiceStatus;
  invoice_number: string | null;
  draft_key: string;
  invoice_date: string;
  due_date: string | null;
  po_number: string | null;
  service_date: string | null;
  service_period: string | null;
  currency: string;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  shipping_cents: number;
  total_cents: number;
  amount_paid_cents: number;
  template: InvoiceTemplate;
  sale_price_cents: number;
  commission_pct: string; // numeric from Postgres, e.g. "3.000"
  commission_amount_cents: number | null; // manual $ override; null = compute from %
  processing_fee_cents: number;
  other_charge_desc: string | null;
  other_charge_cents: number;
  agent_name: string | null;
  second_agent_name: string | null;
  property_address: string | null;
  notes: string | null;
  terms: string | null;
  payment_instructions: string | null;
  snapshot: Record<string, unknown> | null;
  issued_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  position: number;
  item_id: string | null;
  description: string;
  quantity: string; // numeric from Postgres
  unit_label: string;
  unit_price_cents: number;
  discount_cents: number;
  tax_rate: string;
  line_total_cents: number;
  created_at: string;
}
