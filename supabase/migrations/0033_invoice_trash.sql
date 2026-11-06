-- 0033: Invoice Trash — soft delete with restore.
-- Adds deleted_at to invoices. A deleted invoice is NOT removed: its rows,
-- lines, payments and stored PDF/photos stay in place until it is
-- permanently deleted from the Trash. Restoring sets deleted_at back to NULL.
-- Run in the Supabase SQL Editor BEFORE deploying the app code that
-- filters on deleted_at (otherwise the app queries a column that
-- does not exist yet).

alter table public.invoices
  add column if not exists deleted_at timestamptz;

create index if not exists invoices_deleted_idx
  on public.invoices (business_id, deleted_at);

-- Safety: nothing is trashed by this migration. Verify with:
--   select count(*) from public.invoices where deleted_at is not null;
-- Expect 0.
