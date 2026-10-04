import { requireSupabase } from '../lib/supabase';
import type { AuditEvent } from '../db/types';

export async function logAuditEvent(
  businessId: string,
  invoiceId: string | null,
  action: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const sb = requireSupabase();
  const { data: userData } = await sb.auth.getUser();
  const { error } = await sb.from('audit_events').insert({
    business_id: businessId,
    invoice_id: invoiceId,
    actor: userData.user?.id ?? null,
    action,
    details,
  });
  if (error) throw error;
}

export async function listAuditEvents(invoiceId: string): Promise<AuditEvent[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('audit_events')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AuditEvent[];
}
