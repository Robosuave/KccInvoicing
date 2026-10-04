-- 0011: rebuild invoice RLS policies from scratch.
-- can_access_business() tests TRUE when called directly, yet inserts still
-- fail — so drop every invoice/invoice_lines policy and recreate with the
-- simplest proven expressions.

do $$
declare
  r record;
begin
  -- Drop every policy on invoices and invoice_lines.
  for r in select policyname from pg_policies where tablename = 'invoices' loop
    execute format('drop policy if exists %I on public.invoices', r.policyname);
  end loop;
  for r in select policyname from pg_policies where tablename = 'invoice_lines' loop
    execute format('drop policy if exists %I on public.invoice_lines', r.policyname);
  end loop;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'created_by'
  ) then
    -- Ownership model (0008 applied).
    create policy "invoices owner all" on public.invoices
      for all to authenticated
      using (public.can_access_invoice(id))
      with check (public.can_access_business(business_id));

    create policy "invoices agent select" on public.invoices
      for select to authenticated
      using (public.can_access_invoice(id));

    create policy "invoices agent insert" on public.invoices
      for insert to authenticated
      with check (public.can_access_business(business_id));

    create policy "invoices agent update" on public.invoices
      for update to authenticated
      using (public.can_access_invoice(id))
      with check (public.can_access_business(business_id));

    create policy "invoices agent delete" on public.invoices
      for delete to authenticated
      using (public.can_access_invoice(id));
  else
    -- Business-level model.
    create policy "invoices access select" on public.invoices
      for select to authenticated
      using (public.can_access_business(business_id));

    create policy "invoices access insert" on public.invoices
      for insert to authenticated
      with check (public.can_access_business(business_id));

    create policy "invoices access update" on public.invoices
      for update to authenticated
      using (public.can_access_business(business_id))
      with check (public.can_access_business(business_id));

    create policy "invoices access delete" on public.invoices
      for delete to authenticated
      using (public.can_access_business(business_id));
  end if;

  create policy "lines access all" on public.invoice_lines
    for all to authenticated
    using (exists (
      select 1 from public.invoices i
      where i.id = invoice_lines.invoice_id and public.can_access_business(i.business_id)
    ))
    with check (exists (
      select 1 from public.invoices i
      where i.id = invoice_id and public.can_access_business(i.business_id)
    ));
end
$$;

-- Force PostgREST to reload its schema cache so the new policies take effect.
notify pgrst, 'reload schema';
