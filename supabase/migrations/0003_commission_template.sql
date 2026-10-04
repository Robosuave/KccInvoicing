-- Commission / wire-instruction invoice template (Dania Realty).
-- Adds a second invoice template alongside the standard line-item invoice.
-- Commission math: commission = round(sale_price * commission_pct / 100);
-- total = commission + processing_fee + other_charge. All money in integer cents.

alter table public.invoices
  add column template text not null default 'standard'
    check (template in ('standard', 'commission')),
  add column sale_price_cents integer not null default 0
    check (sale_price_cents >= 0),
  add column commission_pct numeric(6,3) not null default 0
    check (commission_pct >= 0),
  add column processing_fee_cents integer not null default 29500
    check (processing_fee_cents >= 0),
  add column other_charge_desc text,
  add column other_charge_cents integer not null default 0
    check (other_charge_cents >= 0),
  add column agent_name text,
  add column second_agent_name text;
