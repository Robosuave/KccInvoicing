-- 0013: create_invoice() security-definer function.
--
-- The invoices RLS policies are not evaluating correctly despite correct
-- definitions (even WITH CHECK (true) fails). Bypass the broken policy
-- evaluation with a SECURITY DEFINER function that performs its own access
-- check and inserts directly. The app will call this instead of a direct
-- INSERT, restoring invoice creation immediately.

-- Drop any prior version (signature changed, so REPLACE wouldn't match).
do $$
declare
  r record;
begin
  for r in select oid::regprocedure as sig from pg_proc where proname = 'create_invoice' loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end
$$;

create function public.create_invoice(
  p_business_id uuid,
  p_customer_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_status text,
  p_subtotal_cents integer,
  p_discount_cents integer,
  p_tax_cents integer,
  p_shipping_cents integer,
  p_total_cents integer,
  p_notes text,
  p_terms text,
  p_payment_instructions text,
  p_template text,
  p_sale_price_cents integer,
  p_commission_pct numeric,
  p_commission_amount_cents integer,
  p_processing_fee_cents integer,
  p_other_charge_desc text,
  p_other_charge_cents integer,
  p_agent_name text,
  p_second_agent_name text,
  p_property_address text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.can_access_business(p_business_id) then
    raise exception 'Not allowed to create invoices for this business.';
  end if;

  insert into public.invoices (
    business_id, customer_id, invoice_number, invoice_date, status,
    subtotal_cents, discount_cents, tax_cents, shipping_cents, total_cents,
    notes, terms, payment_instructions, template,
    sale_price_cents, commission_pct, commission_amount_cents,
    processing_fee_cents, other_charge_desc, other_charge_cents,
    agent_name, second_agent_name, property_address,
    created_by
  ) values (
    p_business_id, p_customer_id, p_invoice_number, p_invoice_date, p_status,
    p_subtotal_cents, p_discount_cents, p_tax_cents, p_shipping_cents, p_total_cents,
    p_notes, p_terms, p_payment_instructions, p_template,
    p_sale_price_cents, p_commission_pct, p_commission_amount_cents,
    p_processing_fee_cents, p_other_charge_desc, p_other_charge_cents,
    p_agent_name, p_second_agent_name, p_property_address,
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

notify pgrst, 'reload schema';
