-- 0022: allow agents (business_members) to see their business and own invoices.
--
-- Agents are in business_members, not workspace_members, so the 0014/0020
-- policies (which only check workspace_members) hide everything from them.
-- This adds business_members checks alongside the workspace checks.

-- 1. Businesses: visible to workspace members OR business members.
drop policy if exists "businesses member select" on public.businesses;
create policy "businesses member select" on public.businesses
  for select to authenticated using (
    public.is_workspace_member(workspace_id)
    or exists (
      select 1 from public.business_members m
      where m.business_id = businesses.id and m.user_id = auth.uid()
    )
  );

-- 2. Invoices: agents see only invoices they created in their business.
create or replace function public.can_access_invoice(inv_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.invoices i
    join public.businesses b on b.id = i.business_id
    where i.id = inv_id
      and (
        -- Workspace member: owner sees all, others see own
        (public.is_workspace_member(b.workspace_id)
         and (public.is_workspace_owner(b.workspace_id) or i.created_by = auth.uid()))
        -- Business member (agent): sees only own invoices
        or (exists (
              select 1 from public.business_members m
              where m.business_id = b.id and m.user_id = auth.uid()
            )
            and i.created_by = auth.uid())
      )
  );
$$;

-- 3. Customers: shared — visible to workspace members OR business members.
drop policy if exists "customers member select" on public.customers;
create policy "customers member select" on public.customers
  for select to authenticated using (exists (
    select 1 from public.businesses b
    where b.id = customers.business_id
      and (public.is_workspace_member(b.workspace_id)
           or exists (
             select 1 from public.business_members m
             where m.business_id = b.id and m.user_id = auth.uid()
           ))
  ));

-- 4. Items: same shared access as customers.
drop policy if exists "items member select" on public.items;
create policy "items member select" on public.items
  for select to authenticated using (exists (
    select 1 from public.businesses b
    where b.id = items.business_id
      and (public.is_workspace_member(b.workspace_id)
           or exists (
             select 1 from public.business_members m
             where m.business_id = b.id and m.user_id = auth.uid()
           ))
  ));

notify pgrst, 'reload schema';
