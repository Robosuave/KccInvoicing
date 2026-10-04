-- 0006: optional header line under the business name on invoices (e.g. "Robert Kaleky, Broker").
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS header_line text;
