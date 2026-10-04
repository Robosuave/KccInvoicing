-- 0017: company name on customers (both businesses share the customer form).
alter table public.customers
  add column if not exists company text;

notify pgrst, 'reload schema';
