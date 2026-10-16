import { requireSupabase } from '../lib/supabase';
import type { InvoiceEmail } from '../db/types';

/** Latest email per invoice, for list badges. */
export async function emailStatusByInvoice(invoiceIds: string[]): Promise<Record<string, InvoiceEmail>> {
  if (invoiceIds.length === 0) return {};
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('invoice_emails')
    .select('*')
    .in('invoice_id', invoiceIds)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const byInvoice: Record<string, InvoiceEmail> = {};
  for (const row of (data ?? []) as InvoiceEmail[]) {
    if (!byInvoice[row.invoice_id]) byInvoice[row.invoice_id] = row;
  }
  return byInvoice;
}

export async function listEmailsForInvoice(invoiceId: string): Promise<InvoiceEmail[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('invoice_emails')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as InvoiceEmail[];
}

export interface SendInvoiceEmailInput {
  invoice_id: string;
  to: string;
  subject?: string;
  message?: string;
  /** Attach the invoice's timesheet PDF when one is stored. Defaults to true. */
  include_timesheet?: boolean;
}

/** Calls the send-invoice-email edge function. Throws with the server's message on failure. */
export async function sendInvoiceEmail(input: SendInvoiceEmailInput): Promise<{ email_id: string }> {
  const sb = requireSupabase();
  const { data, error } = await sb.functions.invoke('send-invoice-email', { body: input });
  if (error) {
    // Edge function returned a JSON error body when available.
    const msg =
      (data as { error?: string } | null)?.error ||
      (error as { message?: string })?.message ||
      'Could not send the email.';
    throw new Error(msg);
  }
  return data as { email_id: string };
}

export function emailStatusLabel(status: InvoiceEmail['status']): string {
  switch (status) {
    case 'queued':
      return 'Email queued';
    case 'sent':
      return 'Emailed';
    case 'delivered':
      return 'Delivered';
    case 'opened':
      return 'Opened';
    case 'bounced':
      return 'Bounced';
    case 'failed':
      return 'Email failed';
  }
}

export interface BoardUpAttachment {
  filename: string;
  /** Base64-encoded file content (no data: prefix). */
  content: string;
}

export interface SendBoardUpEmailInput {
  business_id: string;
  to: string;
  subject?: string;
  message?: string;
  attachments: BoardUpAttachment[];
}

/** Calls the send-boardup-email edge function. Throws with the server's message on failure. */
export async function sendBoardUpEmail(input: SendBoardUpEmailInput): Promise<{ ok: true }> {
  const sb = requireSupabase();
  const { data, error } = await sb.functions.invoke('send-boardup-email', { body: input });
  if (error) {
    const msg =
      (data as { error?: string } | null)?.error ||
      (error as { message?: string })?.message ||
      'Could not send the email.';
    throw new Error(msg);
  }
  return data as { ok: true };
}

/** Blob -> base64 string (no data: prefix), for edge-function attachments. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read the PDF file.'));
    reader.readAsDataURL(blob);
  });
}
