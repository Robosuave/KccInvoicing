-- 0010: fix invoice INSERT RLS policies broken by 0007.
--
-- 0007 changed the invoices insert WITH CHECK to:
--   exists (select 1 from public.businesses b
--           where b.id = invoices.business_id and ...)
-- Referencing the target table by name inside the EXISTS subquery does not
-- reliably correlate to the new row for INSERT, so every invoice insert was
-- rejected ("new row violates row-level security policy"). Inserts worked
-- before 0007 with the direct column reference, so restore that proven form.
--
-- Safe whether or not 0008 (invoice ownership) was applied: drops every known
-- policy name from both migrations, then recreates the correct set.

do $$
begin
  drop policy if exists "invoices access select" on public.invoices;
  drop policy if exists "invoices access insert" on public.invoices;
  drop policy if exists "invoices access update" on public.invoices;
  drop policy if exists "invoices access delete" on public.invoices;
  drop policy if exists "invoices owner all" on public.invoices;
  drop policy if exists "invoices agent select" on public.invoices;
  drop policy if exists "invoices agent insert" on public.invoices;
  drop policy if exists "invoices agent update" on public.invoices;
  drop policy if exists "lines access all" on public.invoice_lines;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'invoices' and column_name = 'created_by'
  ) then
    -- 0008 applied: keep per-agent ownership (original 0008 policies were correct).
    create policy "invoices owner all" on public.invoices
      for all to authenticated
      using (public.can_access_invoice(id))
      with check (public.can_access_invoice(id));

    create policy "invoices agent select" on public.invoices
      for select to authenticated
      using (public.can_access_invoice(id));

    create policy "invoices agent insert" on public.invoices
      for insert to authenticated
      with check (public.can_access_business(business_id));

    create policy "invoices agent update" on public.invoices
      for update to authenticated
      using (public.can_access_invoice(id))
      with check (public.can_access_invoice(id));
  else
    -- 0007 only: business-level access, with the proven direct-column checks.
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

  -- Invoice lines: direct column reference in WITH CHECK (proven pattern).
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
