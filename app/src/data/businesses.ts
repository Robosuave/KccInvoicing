import { requireSupabase } from '../lib/supabase';
import type { Business, Workspace } from '../db/types';

export async function ensureWorkspace(): Promise<Workspace> {
  const sb = requireSupabase();
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error('Not signed in.');

  const { data: memberships, error: mErr } = await sb
    .from('workspace_members')
    .select('workspace_id, workspaces(id, name, created_at)')
    .eq('user_id', user.id)
    .limit(1);
  if (mErr) throw mErr;

  // Agents invited via business_members don't need their own workspace —
  // return their assigned business's workspace instead of creating orphans.
  // This is checked FIRST so an agent who previously ended up as owner of an
  // empty orphan workspace (invite never redeemed) still lands in their
  // assigned business once the invite is redeemed.
  const { data: bizMemberships, error: bErr } = await sb
    .from('business_members')
    .select('business_id, businesses!inner(workspace_id)')
    .eq('user_id', user.id)
    .limit(1);
  if (bErr) throw bErr;
  if (bizMemberships && bizMemberships.length > 0) {
    // Select the workspace directly: the nested workspaces(...) join can come
    // back null under RLS (no workspaces SELECT policy for the agent), which
    // used to crash refresh() on ws.id. The direct select fails loudly instead.
    const workspaceId = (bizMemberships[0] as unknown as { businesses: { workspace_id: string } }).businesses.workspace_id;
    const { data: ws, error: wsErr } = await sb
      .from('workspaces')
      .select('id, name, created_at')
      .eq('id', workspaceId)
      .single();
    if (wsErr) throw wsErr;
    return ws as Workspace;
  }

  if (memberships && memberships.length > 0) {
    return (memberships[0] as unknown as { workspaces: Workspace }).workspaces;
  }

  // NOTE: the id is generated client-side so the owner membership can be
  // inserted BEFORE the workspace is ever SELECTed. The RLS SELECT policy
  // on workspaces requires membership (is_workspace_member), which cannot
  // exist yet on first run — so insert().select().single() would always
  // fail here with zero rows returned.
  const wsId = crypto.randomUUID();
  const { error: wErr } = await sb
    .from('workspaces')
    .insert({ id: wsId, name: 'My Workspace' });
  if (wErr) throw wErr;
  const { error: mmErr } = await sb
    .from('workspace_members')
    .insert({ workspace_id: wsId, user_id: user.id, role: 'owner' });
  if (mmErr) throw mmErr;
  const { data: ws, error: wsErr } = await sb
    .from('workspaces')
    .select('*')
    .eq('id', wsId)
    .single();
  if (wsErr) throw wsErr;
  return ws as Workspace;
}

export async function listBusinesses(workspaceId: string): Promise<Business[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('businesses')
    .select('*')
    .eq('workspace_id', workspaceId)
    .is('archived_at', null)
    .order('display_name');
  if (error) throw error;
  return data as Business[];
}

export type BusinessInput = Partial<Business> & { display_name: string; workspace_id: string };

export async function createBusiness(input: BusinessInput): Promise<Business> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('businesses').insert(input).select().single();
  if (error) throw error;
  return data as Business;
}

export async function updateBusiness(id: string, patch: Partial<Business>): Promise<Business> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('businesses').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data as Business;
}

/** Businesses with history are archived, never hard-deleted (spec §1). */
export async function archiveBusiness(id: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb
    .from('businesses')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Signed URL for a private logo file (short-lived). */
export async function getLogoUrl(logoPath: string): Promise<string | null> {
  const sb = requireSupabase();
  const { data, error } = await sb.storage.from('business-logos').createSignedUrl(logoPath, 3600);
  if (error) return null;
  return data.signedUrl;
}

/** Upload a logo under <workspace_id>/<business_id>/ — matches the storage RLS policy. */
export async function uploadLogo(
  workspaceId: string,
  businessId: string,
  file: File,
): Promise<string> {
  const sb = requireSupabase();
  if (file.size > 2 * 1024 * 1024) throw new Error('Logo must be under 2 MB.');
  if (!file.type.startsWith('image/')) throw new Error('Logo must be an image file.');
  const ext = file.name.split('.').pop() ?? 'png';
  const path = `${workspaceId}/${businessId}/logo.${ext}`;
  const { error } = await sb.storage.from('business-logos').upload(path, file, { upsert: true });
  if (error) throw error;
  return path;
}

export async function getBusiness(id: string): Promise<Business> {
  const sb = requireSupabase();
  const { data, error } = await sb.from('businesses').select('*').eq('id', id).single();
  if (error) throw error;
  return data as Business;
}
