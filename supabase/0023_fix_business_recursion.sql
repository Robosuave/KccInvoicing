-- 0023: fix infinite recursion from 0022.
--
-- The 0022 "businesses member select" policy queried business_members directly,
-- but business_members' own policy queries businesses -> infinite recursion.
-- This uses a SECURITY DEFINER helper (bypasses RLS) to break the cycle.

create or replace function public.is_business_member(b_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = b_id and m.user_id = auth.uid()
  );
$$;

drop policy if exists "businesses member select" on public.businesses;
create policy "businesses member select" on public.businesses
  for select to authenticated using (
    public.is_workspace_member(workspace_id)
    or public.is_business_member(businesses.id)
  );

notify pgrst, 'reload schema';
