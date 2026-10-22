import { requireSupabase } from '../lib/supabase';
import type { BoardUpCrewContact } from '../lib/boardup';

/** Load crew contacts for a business, in display order. Empty list on any error. */
export async function listCrewContacts(businessId: string): Promise<BoardUpCrewContact[]> {
  try {
    const sb = requireSupabase();
    const { data, error } = await sb
      .from('boardup_crew')
      .select('id, name, phone, email')
      .eq('business_id', businessId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error || !data) return [];
    return (data as Array<{ id: string; name: string; phone: string | null; email: string | null }>).map(
      (r) => ({ id: r.id, name: r.name ?? '', phone: r.phone ?? '', email: r.email ?? '' }),
    );
  } catch {
    return [];
  }
}

export interface CrewContactInput {
  id?: string;
  name: string;
  phone: string;
  email: string;
}

/**
 * Replace the business's crew contacts with the given rows.
 * Rows with an id are updated; rows without are inserted; existing rows
 * missing from the list are deleted. Throws on failure.
 */
export async function saveCrewContacts(businessId: string, rows: CrewContactInput[]): Promise<void> {
  const sb = requireSupabase();
  const existing = await listCrewContacts(businessId);
  const existingIds = new Set(existing.map((c) => c.id));
  const keepIds = new Set(rows.map((r) => r.id).filter(Boolean) as string[]);

  for (const [i, r] of rows.entries()) {
    const payload = {
      business_id: businessId,
      name: r.name.trim(),
      phone: r.phone.trim(),
      email: r.email.trim(),
      sort_order: i,
      updated_at: new Date().toISOString(),
    };
    if (r.id && existingIds.has(r.id)) {
      const { error } = await sb.from('boardup_crew').update(payload).eq('id', r.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await sb.from('boardup_crew').insert(payload);
      if (error) throw new Error(error.message);
    }
  }
  const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
  if (toDelete.length > 0) {
    const { error } = await sb.from('boardup_crew').delete().in('id', toDelete);
    if (error) throw new Error(error.message);
  }
}
