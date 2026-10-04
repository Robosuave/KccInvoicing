-- 0009: make assign_invoice_number lock-free-ish. The SELECT ... FOR UPDATE
-- could wait on a row lock indefinitely; this version does a single atomic
-- UPDATE ... RETURNING (minimal lock hold) and aborts fast on any lock wait.

create or replace function public.assign_invoice_number(b_id uuid)
returns text
language plpgsql
security definer
as $$
declare
  pfx text;
  num integer;
begin
  if not public.can_access_business(b_id) then
    raise exception 'Not allowed to create invoices for this business.';
  end if;

  -- Never wait forever on a row lock — fail fast with a clear error instead.
  execute 'SET LOCAL lock_timeout = ''8s''';

  update public.businesses
  set next_number = next_number + 1
  where id = b_id
  returning invoice_prefix, next_number - 1 into pfx, num;

  if num is null then
    raise exception 'Business not found.';
  end if;

  return coalesce(pfx, '') || num::text;
end;
$$;
