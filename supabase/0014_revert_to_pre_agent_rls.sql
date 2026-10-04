-- 0014: revert to pre-agent RLS (the working state before 0007).
--
-- The agent/team RLS changes (0007+) broke invoice INSERTs in a way that
-- resisted multiple fix attempts. This migration drops all agent-related
-- policies and functions, restoring the simple 0001-style workspace-member
-- policies that worked. Agent features can be re-added carefully later.

do $$
declare
  r record;
begin
  -- Drop all policies on the affected tables.
  for r in select policyname from pg_policies where tablename in
    ('invoices', 'invoice_lines', 'businesses', 'customers', 'items', 'business_members', 'business_invites')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname,
      (select tablename from pg_policies where policyname = r.policyname limit 1));
  end loop;
end
$$;

-- Restore 0001-style policies using is_workspace_member (simple, proven).

-- businesses
create policy "businesses member select" on public.businesses
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "businesses member insert" on public.businesses
  for insert to authenticated with check (public.is_workspace_member(workspace_id));
create policy "businesses member update" on public.businesses
  for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
create policy "businesses member delete" on public.businesses
  for delete to authenticated using (public.is_workspace_member(workspace_id));

-- customers
create policy "customers member select" on public.customers
  for select to authenticated using (exists (
    select 1 from public.businesses b
    where b.id = customers.business_id and public.is_workspace_member(b.workspace_id)));
create policy "customers member insert" on public.customers
  for insert to authenticated with check (exists (
    select 1 from public.businesses b
    where b.id = customers.business_id and public.is_workspace_member(b.workspace_id)));
create policy "customers member update" on public.customers
  for update to authenticated
  using (exists (select 1 from public.businesses b
    where b.id = customers.business_id and public.is_workspace_member(b.workspace_id)))
  with check (exists (select 1 from public.businesses b
    where b.id = customers.business_id and public.is_workspace_member(b.workspace_id)));
create policy "customers member delete" on public.customers
  for delete to authenticated using (exists (
    select 1 from public.businesses b
    where b.id = customers.business_id and public.is_workspace_member(b.workspace_id)));

-- items
create policy "items member select" on public.items
  for select to authenticated using (exists (
    select 1 from public.businesses b
    where b.id = items.business_id and public.is_workspace_member(b.workspace_id)));
create policy "items member insert" on public.items
  for insert to authenticated with check (exists (
    select 1 from public.businesses b
    where b.id = items.business_id and public.is_workspace_member(b.workspace_id)));
create policy "items member update" on public.items
  for update to authenticated
  using (exists (select 1 from public.businesses b
    where b.id = items.business_id and public.is_workspace_member(b.workspace_id)))
  with check (exists (select 1 from public.businesses b
    where b.id = items.business_id and public.is_workspace_member(b.workspace_id)));
create policy "items member delete" on public.items
  for delete to authenticated using (exists (
    select 1 from public.businesses b
    where b.id = items.business_id and public.is_workspace_member(b.workspace_id)));

-- invoices (the critical one — restores the working 0001 pattern)
create policy "invoices member select" on public.invoices
  for select to authenticated using (exists (
    select 1 from public.businesses b
    where b.id = invoices.business_id and public.is_workspace_member(b.workspace_id)));
create policy "invoices member insert" on public.invoices
  for insert to authenticated with check (exists (
    select 1 from public.businesses b
    where b.id = invoices.business_id and public.is_workspace_member(b.workspace_id)));
create policy "invoices member update" on public.invoices
  for update to authenticated
  using (exists (select 1 from public.businesses b
    where b.id = invoices.business_id and public.is_workspace_member(b.workspace_id)))
  with check (exists (select 1 from public.businesses b
    where b.id = invoices.business_id and public.is_workspace_member(b.workspace_id)));
create policy "invoices member delete" on public.invoices
  for delete to authenticated using (exists (
    select 1 from public.businesses b
    where b.id = invoices.business_id and public.is_workspace_member(b.workspace_id)));

-- invoice lines
create policy "lines member all" on public.invoice_lines
  for all to authenticated
  using (exists (
    select 1 from public.invoices i
    join public.businesses b on b.id = i.business_id
    where i.id = invoice_lines.invoice_id and public.is_workspace_member(b.workspace_id)))
  with check (exists (
    select 1 from public.invoices i
    join public.businesses b on b.id = i.business_id
    where i.id = invoice_lines.invoice_id and public.is_workspace_member(b.workspace_id)));

-- Drop the agent-related functions (they're not needed in the reverted state).
-- Keep the tables (harmless if empty) and created_by column/trigger (harmless).
drop function if exists public.can_access_business(uuid) cascade;
drop function if exists public.can_access_invoice(uuid) cascade;
drop function if exists public.assign_invoice_number(uuid) cascade;
drop function if exists public.create_invoice(uuid,uuid,text,date,text,integer,integer,integer,integer,integer,text,text,text,text,integer,numeric,integer,integer,text,integer,text,text,text) cascade;
drop function if exists public.redeem_my_invites() cascade;

notify pgrst, 'reload schema';
