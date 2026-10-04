-- 0012: rewrite RLS helper functions as plpgsql.
--
-- Root cause of the invoice INSERT failures: can_access_business() and
-- is_workspace_owner() were LANGUAGE SQL. PostgreSQL inlines simple SQL
-- functions directly into RLS policy expressions, which silently discards
-- their SECURITY DEFINER attribute. Inlined, the inner "select from
-- businesses" re-triggers RLS as the caller instead of bypassing it, so the
-- check mis-evaluates and every INSERT is rejected.
-- plpgsql functions are never inlined, so SECURITY DEFINER is honored.

create or replace function public.is_workspace_owner(w_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.workspace_members m
    where m.workspace_id = w_id
      and m.user_id = auth.uid()
      and m.role = 'owner'
  );
end;
$$;

create or replace function public.can_access_business(b_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.businesses b
    where b.id = b_id
      and (
        public.is_workspace_owner(b.workspace_id)
        or exists (
          select 1 from public.business_members m
          where m.business_id = b_id and m.user_id = auth.uid()
        )
      )
  );
end;
$$;

create or replace function public.can_access_invoice(inv_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.invoices i
    join public.businesses b on b.id = i.business_id
    where i.id = inv_id
      and public.can_access_business(b.id)
      and (
        public.is_workspace_owner(b.workspace_id)
        or i.created_by = auth.uid()
      )
  );
end;
$$;

notify pgrst, 'reload schema';
