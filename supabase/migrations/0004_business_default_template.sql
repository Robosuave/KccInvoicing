-- Per-business default invoice template.
-- Dania Realty uses the commission / wire-instruction form by default;
-- Kaleky Computer Consulting keeps the standard line-item invoice.

alter table public.businesses
  add column default_template text not null default 'standard'
    check (default_template in ('standard', 'commission'));
