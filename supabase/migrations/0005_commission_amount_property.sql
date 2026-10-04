-- Commission amount ($) override + property address (Dania Realty).
-- The paper form has "Real Estate Commission [ % ] $ [ ]": the $ box is
-- auto-filled from % x sale price but stays editable. When
-- commission_amount_cents is set it is the source of truth for the total;
-- when NULL the commission is computed from commission_pct.
-- property_address holds the property address from the HUD / closing statement.

alter table public.invoices
  add column commission_amount_cents integer
    check (commission_amount_cents >= 0),
  add column property_address text;
