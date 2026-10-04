-- 0015: restore team-table access (0014 dropped these policies without replacing them).
--
-- business_members and business_invites need simple workspace-member policies
-- so the owner can invite/remove agents and see the team lists.

-- business_members: workspace members can read and manage.
-- (DROP IF EXISTS guards make this safe to re-run after a partial apply.)
drop policy if exists "business_members member read" on public.business_members;
create policy "business_members member read" on public.business_members
  for select to authenticated using (exists (
    select 1 from public.businesses b
    where b.id = business_members.business_id
      and public.is_workspace_member(b.workspace_id)));
drop policy if exists "business_members member manage" on public.business_members;
create policy "business_members member manage" on public.business_members
  for all to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id = business_members.business_id
      and public.is_workspace_member(b.workspace_id)))
  with check (exists (
    select 1 from public.businesses b
    where b.id = business_members.business_id
      and public.is_workspace_member(b.workspace_id)));

-- business_invites: workspace members can read, invite, and cancel.
drop policy if exists "business_invites member read" on public.business_invites;
create policy "business_invites member read" on public.business_invites
  for select to authenticated using (exists (
    select 1 from public.businesses b
    where b.id = business_invites.business_id
      and public.is_workspace_member(b.workspace_id)));
drop policy if exists "business_invites member insert" on public.business_invites;
create policy "business_invites member insert" on public.business_invites
  for insert to authenticated with check (exists (
    select 1 from public.businesses b
    where b.id = business_invites.business_id
      and public.is_workspace_member(b.workspace_id)));
drop policy if exists "business_invites member delete" on public.business_invites;
create policy "business_invites member delete" on public.business_invites
  for delete to authenticated using (exists (
    select 1 from public.businesses b
    where b.id = business_invites.business_id
      and public.is_workspace_member(b.workspace_id)));

-- Restore redeem_my_invites (dropped in 0014). Runs on login; adds the
-- signed-in user to any businesses they were invited to by email.
create or replace function public.redeem_my_invites()
returns integer
language plpgsql
security definer
as $$
declare
  n integer := 0;
  r record;
  u_email text := lower(auth.jwt() ->> 'email');
  u_id uuid := auth.uid();
begin
  if u_id is null or u_email is null then
    return 0;
  end if;
  for r in
    select i.business_id, b.workspace_id
    from public.business_invites i
    join public.businesses b on b.id = i.business_id
    where lower(i.email) = u_email
  loop
    insert into public.workspace_members (workspace_id, user_id, role)
    values (r.workspace_id, u_id, 'agent')
    on conflict (workspace_id, user_id) do nothing;

    insert into public.business_members (business_id, user_id, email, role)
    values (r.business_id, u_id, u_email, 'agent')
    on conflict (business_id, user_id) do nothing;

    delete from public.business_invites
    where business_id = r.business_id and lower(email) = u_email;

    n := n + 1;
  end loop;
  return n;
end;
$$;

notify pgrst, 'reload schema';
