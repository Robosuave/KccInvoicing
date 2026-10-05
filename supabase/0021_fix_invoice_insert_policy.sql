-- 0021 (revised): fix the invoice INSERT policy.
--
-- The invoices table has NO workspace_id column (it links via business_id),
-- so the 0014-style policy referencing workspace_id can never be created.
-- This version checks workspace membership via the businesses join directly,
-- inlining the membership test instead of calling the helper function.

drop policy if exists "invoices member insert" on public.invoices;

create policy "invoices member insert"
  on public.invoices for insert to authenticated
  with check (exists (
    select 1
    from public.businesses b
    join public.workspace_members m on m.workspace_id = b.workspace_id
    where b.id = business_id
      and m.user_id = auth.uid()
  ));

notify pgrst, 'reload schema';
