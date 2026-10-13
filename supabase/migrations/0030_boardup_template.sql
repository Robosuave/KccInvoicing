-- Board-Up job template (Quick Board-Up company).
-- Extends the template check constraints to include 'boardup', adds a JSONB
-- column for the board-up job-sheet fields, and includes it in the frozen
-- issuance snapshot. Idempotent: safe to run more than once.

do $$
declare
  r record;
begin
  -- Drop existing check constraints on invoices.template (whatever their names)
  for r in
    select conname from pg_constraint
    where conrelid = 'public.invoices'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%template%'
  loop
    execute format('alter table public.invoices drop constraint %I', r.conname);
  end loop;
  -- Drop existing check constraints on businesses.default_template (whatever their names)
  for r in
    select conname from pg_constraint
    where conrelid = 'public.businesses'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%default_template%'
  loop
    execute format('alter table public.businesses drop constraint %I', r.conname);
  end loop;
end $$;

-- Re-add with 'boardup' included (skipped if already present)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoices'::regclass
      and conname = 'invoices_template_check'
  ) then
    alter table public.invoices
      add constraint invoices_template_check
      check (template in ('standard', 'commission', 'boardup'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.businesses'::regclass
      and conname = 'businesses_default_template_check'
  ) then
    alter table public.businesses
      add constraint businesses_default_template_check
      check (default_template in ('standard', 'commission', 'boardup'));
  end if;
end $$;

-- JSONB payload for the board-up job sheet fields (material estimates only;
-- no dollar amounts — see app/src/lib/boardup.ts)
alter table public.invoices add column if not exists boardup_details jsonb;

-- Include the board-up payload in the frozen issuance snapshot so issued
-- job sheets render from immutable data like other templates.
create or replace function public.freeze_invoice_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_business jsonb;
  v_customer jsonb;
  v_lines jsonb;
  v_pay_instr text;
begin
  if not (NEW.status = 'issued' and OLD.status is distinct from 'issued' and NEW.snapshot is null) then
    return NEW;
  end if;

  select jsonb_build_object(
    'display_name', b.display_name,
    'legal_name', b.legal_name,
    'header_line', b.header_line,
    'logo_path', b.logo_path,
    'address_line1', b.address_line1,
    'address_line2', b.address_line2,
    'city', b.city, 'state', b.state, 'zip', b.zip,
    'phone', b.phone, 'email', b.email, 'website', b.website,
    'tax_id', b.tax_id
  ) into v_business
  from public.businesses b where b.id = NEW.business_id;

  select jsonb_build_object(
    'name', c.name,
    'company', c.company,
    'contact_person', c.contact_person,
    'billing_line1', c.billing_line1, 'billing_line2', c.billing_line2,
    'billing_city', c.billing_city, 'billing_state', c.billing_state, 'billing_zip', c.billing_zip,
    'email', c.email, 'phone', c.phone
  ) into v_customer
  from public.customers c where c.id = NEW.customer_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'position', l.position,
      'description', l.description,
      'quantity', l.quantity,
      'unit_label', l.unit_label,
      'unit_price_cents', l.unit_price_cents,
      'discount_cents', l.discount_cents,
      'tax_rate', l.tax_rate,
      'line_total_cents', l.line_total_cents
    ) order by l.position
  ), '[]'::jsonb) into v_lines
  from public.invoice_lines l where l.invoice_id = NEW.id;

  -- Payment instructions: prefer the 0016-frozen snapshot; fall back to the
  -- business default regardless of trigger firing order.
  v_pay_instr := coalesce(
    NEW.payment_instructions_snapshot,
    (select b2.payment_instructions from public.businesses b2 where b2.id = NEW.business_id)
  );

  NEW.snapshot := jsonb_build_object(
    'version', 2,
    'invoice_number', NEW.invoice_number,
    'template', NEW.template,
    'currency', NEW.currency,
    'invoice_date', NEW.invoice_date,
    'due_date', NEW.due_date,
    'po_number', NEW.po_number,
    'service_date', NEW.service_date,
    'service_period', NEW.service_period,
    'business', v_business,
    'customer', v_customer,
    'lines', v_lines,
    'commission', jsonb_build_object(
      'sale_price_cents', NEW.sale_price_cents,
      'commission_pct', NEW.commission_pct,
      'commission_amount_cents', NEW.commission_amount_cents,
      'processing_fee_cents', NEW.processing_fee_cents,
      'other_charge_desc', NEW.other_charge_desc,
      'other_charge_cents', NEW.other_charge_cents,
      'agent_name', NEW.agent_name,
      'second_agent_name', NEW.second_agent_name,
      'property_address', NEW.property_address
    ),
    'boardup_details', NEW.boardup_details,
    'totals', jsonb_build_object(
      'subtotal_cents', NEW.subtotal_cents,
      'discount_cents', NEW.discount_cents,
      'tax_cents', NEW.tax_cents,
      'tax_by_rate', coalesce(NEW.tax_breakdown, '[]'::jsonb),
      'shipping_cents', NEW.shipping_cents,
      'total_cents', NEW.total_cents
    ),
    'notes', NEW.notes,
    'terms', NEW.terms,
    'payment_instructions', v_pay_instr,
    'issued_at', now()
  );

  return NEW;
end $func$;
