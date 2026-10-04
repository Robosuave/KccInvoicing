import { requireSupabase } from '../lib/supabase';
import { buildSnapshot, type InvoiceSnapshot } from '../lib/snapshot';
import { getBusiness } from './businesses';
import { getCustomer } from './customers';
import { getDraft } from './drafts';
import type { Business } from '../db/types';

/** The number that WILL be assigned (shown for confirmation; the RPC assigns atomically). */
export function previewNextNumber(business: Business): string {
  return `${business.invoice_prefix}${business.next_number}`;
}

/**
 * Issue a draft: builds the immutable snapshot, then calls the atomic
 * issue_invoice RPC (assigns the number, flips status, writes audit).
 * Throws if totals drifted since the draft was saved.
 */
export async function issueInvoice(
  draftId: string,
  templateId: string,
): Promise<{ invoiceNumber: string; snapshot: InvoiceSnapshot }> {
  const sb = requireSupabase();
  const { invoice, lines } = await getDraft(draftId);
  if (invoice.status !== 'draft') throw new Error('Only drafts can be issued.');
  if (lines.length === 0) throw new Error('Add at least one line item before issuing.');

  const business = await getBusiness(invoice.business_id);
  const customer = invoice.customer_id ? await getCustomer(invoice.customer_id) : null;
  const snapshot = buildSnapshot(invoice, lines, business, customer, templateId);

  const { data, error } = await sb.rpc('issue_invoice', {
    p_invoice_id: draftId,
    p_snapshot: snapshot,
  });
  if (error) throw error;

  const invoiceNumber = data as string;
  snapshot.invoice_number = invoiceNumber;
  snapshot.issued_at = new Date().toISOString();
  return { invoiceNumber, snapshot };
}
