import { requireSupabase } from '../lib/supabase';
import type { Item } from '../db/types';

export async function listItems(businessId: string, opts: { includeInactive?: boolean; search?: string } = {}): Promise<Item[]> {
  const sb = requireSupabase();
  let q = sb.from('items').select('*').eq('business_id', businessId).order('name');
  if (!opts.includeInactive) q = q.eq('active', true);
  if (opts.search?.trim()) q = q.ilike('name', `%${opts.search.trim()}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data as Item[];
}

export type ItemInput = Partial<Item> & { name: string; business_id: string };

export async function createItem(input: ItemInput): Promise<Item> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('items').insert(input).select().single();
  if (error) throw error;
  return data as Item;
}

export async function updateItem(id: string, patch: Partial<Item>): Promise<Item> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('items').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data as Item;
}

/** Archive (deactivate) instead of delete — issued invoices keep their snapshots. */
export async function archiveItem(id: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from('items').update({ active: false }).eq('id', id);
  if (error) throw error;
}
