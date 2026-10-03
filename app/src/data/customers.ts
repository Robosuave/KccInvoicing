import { requireSupabase } from '../lib/supabase';
import type { Customer } from '../db/types';

export async function listCustomers(businessId: string, search = ''): Promise<Customer[]> {
  const sb = requireSupabase();
  let q = sb
    .from('customers')
    .select('*')
    .eq('business_id', businessId)
    .is('archived_at', null)
    .order('name');
  if (search.trim()) q = q.ilike('name', `%${search.trim()}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data as Customer[];
}

export async function getCustomer(id: string): Promise<Customer> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('customers').select('*').eq('id', id).single();
  if (error) throw error;
  return data as Customer;
}

export type CustomerInput = Partial<Customer> & { name: string; business_id: string };

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('customers').insert(input).select().single();
  if (error) throw error;
  return data as Customer;
}

export async function updateCustomer(id: string, patch: Partial<Customer>): Promise<Customer> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('customers').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data as Customer;
}

/** Archive instead of delete — preserves invoice history references. */
export async function archiveCustomer(id: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('customers')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Explicit copy to another business — never silent sharing (spec §1). */
export async function copyCustomerToBusiness(customerId: string, targetBusinessId: string): Promise<Customer> {
  const src = await getCustomer(customerId);
  const { id: _id, business_id: _b, created_at: _c, updated_at: _u, archived_at: _a, ...rest } = src;
  return createCustomer({ ...rest, business_id: targetBusinessId });
}
