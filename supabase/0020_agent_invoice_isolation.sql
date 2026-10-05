-- 0020: agent invoice isolation (careful re-implementation on the working 0014 base).
--
-- Agents see ONLY the invoices they created; the workspace owner sees everything.
-- Customers, items, and businesses remain shared among all workspace members.
--
-- The trigger auto-stamps created_by = auth.uid() on insert, so the app needs
-- no changes and the value cannot be spoofed by the client.

-- 1. Ensure the created_by column exists.
alter table public.invoices
  add column if not exists created_by uuid references auth.users(id);

-- 2. Attribute pre-existing invoices with NULL created_by to the workspace owner.
update public.invoices i
set created_by = (
  select m.user_id
  from public.workspace_members m
  join public.businesses b on b.workspace_id = m.workspace_id
  where b.id = i.business_id and m.role = 'owner'
  limit 1
)
where i.created_by is null;

-- 3. Trigger: stamp the creator on every insert (cannot be spoofed by the client).
create or replace function public.set_invoice_created_by()
returns trigger
language plpgsql
as $$
begin
  NEW.created_by := auth.uid();
  return NEW;
end;
$$;

drop trigger if exists invoices_set_created_by on public.invoices;
create trigger invoices_set_created_by
  before insert on public.invoices
  for each row execute function public.set_invoice_created_by();

-- 4. Helper: a user may access an invoice when they are a workspace member AND
-- they own the workspace or they created the invoice.
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
      and public.is_workspace_member(b.workspace_id)
      and (public.is_workspace_owner(b.workspace_id) or i.created_by = auth.uid())
  );
$$;

-- 5. Replace the 0014 invoice policies with owner-or-creator policies.
drop policy if exists "invoices member select" on public.invoices;
drop policy if exists "invoices member insert" on public.invoices;
drop policy if exists "invoices member update" on public.invoices;
drop policy if exists "invoices member delete" on public.invoices;

create policy "invoices owner-or-creator select"
  on public.invoices for select to authenticated
  using (public.can_access_invoice(id));

-- Insert stays open to all members; the trigger stamps created_by automatically.
create policy "invoices member insert"
  on public.invoices for insert to authenticated
  with check (exists (
    select 1 from public.businesses b
    where b.id = invoices.business_id and public.is_workspace_member(b.workspace_id)
  ));

create policy "invoices owner-or-creator update"
  on public.invoices for update to authenticated
  using (public.can_access_invoice(id))
  with check (exists (
    select 1 from public.businesses b
    where b.id = invoices.business_id and public.is_workspace_member(b.workspace_id)
  ));

create policy "invoices owner-or-creator delete"
  on public.invoices for delete to authenticated
  using (public.can_access_invoice(id));

-- 6. Invoice lines follow the parent invoice's visibility.
drop policy if exists "lines member all" on public.invoice_lines;

create policy "lines owner-or-creator all"
  on public.invoice_lines for all to authenticated
  using (public.can_access_invoice(invoice_id))
  with check (public.can_access_invoice(invoice_id));

-- 7. Customers, items, businesses: unchanged (shared among all members).

notify pgrst, 'reload schema';
