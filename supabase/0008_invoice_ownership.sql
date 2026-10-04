-- 0008: invoice ownership. Agents see only the invoices they created;
-- the workspace owner sees every invoice in the business.

alter table public.invoices
  add column if not exists created_by uuid references auth.users(id);

-- Attribute pre-existing invoices to the workspace owner.
update public.invoices i
set created_by = (
  select m.user_id
  from public.workspace_members m
  join public.businesses b on b.workspace_id = m.workspace_id
  where b.id = i.business_id and m.role = 'owner'
  limit 1
)
where i.created_by is null;

-- Stamp the creator on every insert (cannot be spoofed by the client).
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

-- A user may touch an invoice row when they can access its business AND
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
      and public.can_access_business(b.id)
      and (public.is_workspace_owner(b.workspace_id) or i.created_by = auth.uid())
  );
$$;

-- ============ replace the 0007 invoice policies ============

drop policy if exists "invoices access select" on public.invoices;
drop policy if exists "invoices access insert" on public.invoices;
drop policy if exists "invoices access update" on public.invoices;
drop policy if exists "invoices access delete" on public.invoices;

create policy "invoices owner-or-creator select"
  on public.invoices for select
  using (public.can_access_invoice(id));

create policy "invoices access insert"
  on public.invoices for insert
  with check (exists (
    select 1 from public.businesses b
    where b.id = invoices.business_id and public.can_access_business(b.id)
  ));

create policy "invoices owner-or-creator update"
  on public.invoices for update
  using (public.can_access_invoice(id))
  with check (exists (
    select 1 from public.businesses b
    where b.id = invoices.business_id and public.can_access_business(b.id)
  ));

create policy "invoices owner-or-creator delete"
  on public.invoices for delete
  using (public.can_access_invoice(id));

-- invoice lines follow the same ownership rule through their invoice
drop policy if exists "lines access all" on public.invoice_lines;
create policy "lines owner-or-creator all"
  on public.invoice_lines for all
  using (exists (
    select 1 from public.invoices i
    join public.businesses b on b.id = i.business_id
    where i.id = invoice_lines.invoice_id
      and public.can_access_business(b.id)
      and (public.is_workspace_owner(b.workspace_id) or i.created_by = auth.uid())
  ))
  with check (exists (
    select 1 from public.invoices i
    join public.businesses b on b.id = i.business_id
    where i.id = invoice_lines.invoice_id
      and public.can_access_business(b.id)
      and (public.is_workspace_owner(b.workspace_id) or i.created_by = auth.uid())
  ));
