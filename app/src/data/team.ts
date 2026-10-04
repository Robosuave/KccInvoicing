import { requireSupabase } from '../lib/supabase';

export interface BusinessMember {
  business_id: string;
  user_id: string;
  email: string;
  role: string;
  created_at: string;
}

export interface BusinessInvite {
  id: string;
  business_id: string;
  email: string;
  created_at: string;
}

/** Redeem any pending email invites for the signed-in user. Safe to call on every login. */
export async function redeemInvites(): Promise<number> {
  const sb = requireSupabase();
  try {
    const { data, error } = await sb.rpc('redeem_my_invites');
    if (error) return 0;
    return typeof data === 'number' ? data : 0;
  } catch {
    // Migration 0007 not run yet — nothing to redeem.
    return 0;
  }
}

export async function listBusinessMembers(businessId: string): Promise<BusinessMember[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('business_members')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at');
  if (error) throw error;
  return data as BusinessMember[];
}

export async function listBusinessInvites(businessId: string): Promise<BusinessInvite[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('business_invites')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at');
  if (error) throw error;
  return data as BusinessInvite[];
}

export async function inviteAgent(businessId: string, email: string): Promise<void> {
  const sb = requireSupabase();
  const { data: userData } = await sb.auth.getUser();
  const clean = email.trim().toLowerCase();
  if (!clean || !clean.includes('@')) throw new Error('Enter a valid email address.');
  const { error } = await sb.from('business_invites').insert({
    business_id: businessId,
    email: clean,
    created_by: userData.user?.id,
  });
  if (error) {
    if (error.code === '23505') throw new Error('That email is already invited to this business.');
    throw error;
  }
}

export async function cancelInvite(inviteId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from('business_invites').delete().eq('id', inviteId);
  if (error) throw error;
}

export async function removeMember(businessId: string, userId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('business_members')
    .delete()
    .eq('business_id', businessId)
    .eq('user_id', userId);
  if (error) throw error;
}
