-- 0031: board-up "mark done" + Aquick shared agent visibility.
--
-- 1. invoices.completed: lets anyone mark a board-up job done / reopen it.
--    Only the board-up UI uses it; other templates ignore it.
-- 2. businesses.agents_see_all_invoices: when true, every member assigned to
--    the business sees ALL of its invoices, not just the ones they created.
--    Turned on for Aquick Board-up so Dan sees Robert's jobs too.
--    Other businesses (Dania, KCC) keep the owner-or-creator isolation.

-- 1. Mark-done flag.
alter table public.invoices
  add column if not exists completed boolean not null default false;

-- 2. Per-business shared-visibility flag.
alter table public.businesses
  add column if not exists agents_see_all_invoices boolean not null default false;

update public.businesses
set agents_see_all_invoices = true
where name = 'Aquick Board-up'
  and agents_see_all_invoices = false;

-- 3. Access check: same as 0028, plus the shared-visibility exception.
--    For a flagged business, any workspace member or assigned business member
--    may select/update/delete every invoice of that business.
create or replace function public.can_access_invoice(inv_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.invoices i
    join public.businesses b on b.id = i.business_id
    where i.id = inv_id
      and (
        (public.is_workspace_member(b.workspace_id)
         and (public.is_workspace_owner(b.workspace_id)
              or i.created_by = auth.uid()
              or b.agents_see_all_invoices))
        or (public.is_business_member(b.id)
            and (i.created_by = auth.uid() or b.agents_see_all_invoices))
      )
  );
end;
$$;

notify pgrst, 'reload schema';
