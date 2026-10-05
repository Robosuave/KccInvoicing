-- 0021: fix the 0020 INSERT policy (it broke invoice creation).
--
-- The 0020 "invoices member insert" policy used a businesses join that fails
-- the WITH CHECK. Restore the exact 0014 INSERT policy (proven working):
-- any workspace member can insert; the trigger stamps created_by automatically.

drop policy if exists "invoices member insert" on public.invoices;

create policy "invoices member insert"
  on public.invoices for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

notify pgrst, 'reload schema';
