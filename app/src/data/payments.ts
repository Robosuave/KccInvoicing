import { requireSupabase } from '../lib/supabase';
import { balanceDue } from '../lib/money';
import { logAuditEvent } from './audit';
import type { Invoice, Payment, PaymentMethod } from '../db/types';

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export async function listPayments(invoiceId: string): Promise<Payment[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('payments')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('payment_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Payment[];
}

export interface RecordPaymentInput {
  invoice: Invoice;
  amountCents: number;
  method: PaymentMethod;
  reference?: string;
  note?: string;
  paymentDate?: string;
  /** Pass the same key when retrying after a timeout — duplicates are returned, not recreated. */
  idempotencyKey?: string;
}

export async function recordPayment(input: RecordPaymentInput): Promise<Payment> {
  const sb = requireSupabase();
  const { invoice } = input;
  if (invoice.status !== 'issued') throw new Error('Payments can only be recorded on issued invoices.');
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }
  let balance: number;
  try {
    balance = balanceDue(invoice.total_cents, invoice.amount_paid_cents);
  } catch {
    throw new Error('This invoice has no remaining balance.');
  }
  if (input.amountCents > balance) {
    throw new Error(
      `This payment exceeds the remaining balance of $${(balance / 100).toFixed(2)}. ` +
        'Record the exact balance or less.',
    );
  }

  const key = input.idempotencyKey ?? newIdempotencyKey();
  const { data: userData } = await sb.auth.getUser();
  const row = {
    invoice_id: invoice.id,
    business_id: invoice.business_id,
    created_by: userData.user?.id ?? null,
    amount_cents: input.amountCents,
    method: input.method,
    reference: input.reference?.trim() || null,
    note: input.note?.trim() || null,
    payment_date: input.paymentDate || new Date().toISOString().slice(0, 10),
    idempotency_key: key,
  };

  const { data, error } = await sb.from('payments').insert(row).select().single();
  if (error && (error as { code?: string }).code === '23505') {
    // Duplicate submission with the same idempotency key — return the original.
    const { data: existing, error: e2 } = await sb
      .from('payments')
      .select('*')
      .eq('invoice_id', invoice.id)
      .eq('idempotency_key', key)
      .single();
    if (e2) throw e2;
    return existing as Payment;
  }
  if (error) throw error;

  await logAuditEvent(invoice.business_id, invoice.id, 'payment_entry', {
    payment_id: (data as Payment).id,
    amount_cents: input.amountCents,
    method: input.method,
  });
  return data as Payment;
}

/** Reversals are records — the original payment row is never deleted or edited. */
export async function reversePayment(paymentId: string, reason: string): Promise<Payment> {
  const sb = requireSupabase();
  if (!reason.trim()) throw new Error('A reason is required to reverse a payment.');

  const { data: existing, error: gErr } = await sb.from('payments').select('*').eq('id', paymentId).single();
  if (gErr) throw gErr;
  const p = existing as Payment;
  if (p.reversed_at) throw new Error('This payment was already reversed.');

  const { data, error } = await sb
    .from('payments')
    .update({ reversed_at: new Date().toISOString(), reversed_reason: reason.trim() })
    .eq('id', paymentId)
    .select()
    .single();
  if (error) throw error;

  await logAuditEvent(p.business_id, p.invoice_id, 'payment_reversal', {
    payment_id: paymentId,
    amount_cents: p.amount_cents,
    reason: reason.trim(),
  });
  return data as Payment;
}
