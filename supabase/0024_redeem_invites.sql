-- 0024: restore redeem_my_invites (dropped by 0014), agent version.
--
-- Agents are ONLY added to business_members (not workspace_members), so they
-- see just their assigned business, their own invoices, and shared customers.
-- The workspace owner still sees everything.

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
    select i.id as invite_id, i.business_id
    from public.business_invites i
    where lower(i.email) = u_email
  loop
    insert into public.business_members (business_id, user_id, email, role)
    values (r.business_id, u_id, u_email, 'agent')
    on conflict (business_id, user_id) do nothing;

    delete from public.business_invites where id = r.invite_id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

notify pgrst, 'reload schema';
