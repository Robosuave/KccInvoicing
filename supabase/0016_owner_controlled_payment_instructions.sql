-- 0016: owner-controlled payment / wire instructions.
--
-- Requirements:
--  1-3. Invoices may not carry client-supplied payment instructions.
--        The server always loads the value from the business record.
--  4,8. Only the workspace owner may edit a business's default payment
--        instructions; team members creating invoices cannot.
--  7.   When an invoice is issued, the current instructions are frozen into
--        payment_instructions_snapshot so historical invoices keep showing
--        what was in effect at issue time.
--  10.  RLS audit: every policy in this project targets `to authenticated`;
--        there are no `to anon` / `to public` policies, so unauthenticated
--        API calls (anon key, no JWT) match no policy and are denied by
--        default. Wire instructions are never exposed without a login.

-- Snapshot column: frozen copy taken at issue time.
alter table public.invoices
  add column if not exists payment_instructions_snapshot text;

-- Ensure the owner-check helper exists with the correct (plpgsql, non-inlined)
-- definition regardless of which earlier migrations were applied.
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

-- ---------------------------------------------------------------------------
-- Invoices: server-side payment-instructions lock.
--  - INSERT: any client-supplied payment_instructions is discarded; the
--    business default is loaded instead. Snapshot starts NULL.
--  - UPDATE of a draft: payment_instructions is refreshed from the business
--    default (client value ignored); issuing (draft -> issued) freezes the
--    snapshot to the default in effect at that moment.
--  - UPDATE of an issued invoice (snapshot already set): both columns are
--    frozen and cannot be altered, even by the owner.
-- ---------------------------------------------------------------------------
create or replace function public.lock_invoice_payment_instructions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_default text;
begin
  select b.payment_instructions into v_default
  from public.businesses b
  where b.id = NEW.business_id;

  if TG_OP = 'INSERT' then
    NEW.payment_instructions := v_default;
    NEW.payment_instructions_snapshot := null;
    return NEW;
  end if;

  -- UPDATE
  if OLD.payment_instructions_snapshot is not null then
    -- Already issued: freeze both columns.
    NEW.payment_instructions := OLD.payment_instructions;
    NEW.payment_instructions_snapshot := OLD.payment_instructions_snapshot;
    return NEW;
  end if;

  if NEW.status = 'issued' and OLD.status is distinct from 'issued' then
    -- Issuing now: freeze the snapshot to the current business default.
    NEW.payment_instructions_snapshot := v_default;
  end if;
  NEW.payment_instructions := v_default;
  return NEW;
end;
$$;

drop trigger if exists trg_lock_invoice_payment on public.invoices;
create trigger trg_lock_invoice_payment
  before insert or update on public.invoices
  for each row
  execute function public.lock_invoice_payment_instructions();

-- ---------------------------------------------------------------------------
-- Businesses: only the workspace owner may change default payment instructions.
-- Team members (agents) can still update other business fields via RLS, but
-- any attempt to change payment_instructions as a non-owner is rejected.
-- ---------------------------------------------------------------------------
create or replace function public.guard_business_payment_instructions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.payment_instructions is distinct from OLD.payment_instructions then
    if not public.is_workspace_owner(OLD.workspace_id) then
      raise exception 'Only the business owner may change payment instructions.'
        using errcode = '42501';
    end if;
    -- If the row is also being moved between workspaces, require ownership
    -- of the destination too.
    if NEW.workspace_id is distinct from OLD.workspace_id
       and not public.is_workspace_owner(NEW.workspace_id) then
      raise exception 'Only the business owner may change payment instructions.'
        using errcode = '42501';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_guard_business_payinst on public.businesses;
create trigger trg_guard_business_payinst
  before update on public.businesses
  for each row
  execute function public.guard_business_payment_instructions();

notify pgrst, 'reload schema';
