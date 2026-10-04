-- Authorization tests for owner-controlled payment / wire instructions (migration 0016).
--
-- Run in the Supabase SQL Editor as the project owner. Each test runs in its
-- own transaction and rolls back, so no data is changed by running the tests.
--
-- Expected output: four "PASS" notices. Any "FAIL" means the requirement is
-- not enforced.

-- Pick any business for the tests (uses the first one found).
-- All tests restore state via ROLLBACK.

-- ===========================================================================
-- TEST 1: Owner CAN update business payment instructions.
-- ===========================================================================
begin;

do $$
declare
  v_biz uuid;
  v_orig text;
begin
  select id, payment_instructions into v_biz, v_orig
  from public.businesses limit 1;

  update public.businesses
  set payment_instructions = 'TEST-OWNER-EDIT'
  where id = v_biz;

  if (select payment_instructions from public.businesses where id = v_biz) = 'TEST-OWNER-EDIT' then
    raise notice 'PASS 1: owner can update business payment instructions';
  else
    raise notice 'FAIL 1: owner update did not stick';
  end if;
end $$;

rollback;

-- ===========================================================================
-- TEST 2: Team member (non-owner) CANNOT update business payment instructions,
--         but CAN still update other business fields.
-- ===========================================================================
begin;

-- Create a fake agent member (as postgres, bypassing RLS for setup).
do $$
declare
  v_ws uuid;
  v_agent uuid := gen_random_uuid();
begin
  select workspace_id into v_ws from public.businesses limit 1;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws, v_agent, 'agent');

  -- Stash ids for the next block via a temp table (DO blocks can't share vars).
  create temp table _t2 (ws uuid, agent uuid, biz uuid) on commit drop;
  insert into _t2
  select v_ws, v_agent, id from public.businesses limit 1;

  perform set_config('request.jwt.claim.sub', v_agent::text, true);
end $$;

set local role authenticated;

do $$
declare
  v_biz uuid;
  v_before text;
begin
  select biz into v_biz from _t2;
  select payment_instructions into v_before from public.businesses where id = v_biz;

  -- Attempt 1: change payment_instructions as agent -> must be rejected.
  begin
    update public.businesses
    set payment_instructions = 'HACKED-BY-AGENT'
    where id = v_biz;
    raise notice 'FAIL 2a: agent was able to change payment instructions';
  exception when others then
    if SQLSTATE = '42501' then
      raise notice 'PASS 2a: agent blocked from changing payment instructions (42501)';
    else
      raise notice 'FAIL 2a: wrong error %', SQLSTATE;
    end if;
  end;

  -- Attempt 2: change an unrelated field as agent -> must succeed
  -- (proves the guard is specific to payment instructions, not a blanket block).
  begin
    update public.businesses
    set invoice_notes = coalesce(invoice_notes, '') || ' [agent touch]'
    where id = v_biz;
    raise notice 'PASS 2b: agent can still update other business fields';
  exception when others then
    raise notice 'FAIL 2b: agent blocked from harmless field (%)', SQLSTATE;
  end;
end $$;

reset role;
rollback;

-- ===========================================================================
-- TEST 3: Invoice INSERT/UPDATE ignores client-supplied payment_instructions.
-- ===========================================================================
begin;

do $$
declare
  v_biz uuid;
  v_default text;
  v_inv uuid;
  v_stored text;
begin
  select id, payment_instructions into v_biz, v_default
  from public.businesses limit 1;

  -- INSERT with a hostile value.
  insert into public.invoices (business_id, invoice_number, payment_instructions)
  values (v_biz, 'PAYTEST-001', 'HACKED-ON-INSERT')
  returning id into v_inv;

  select payment_instructions into v_stored
  from public.invoices where id = v_inv;

  if v_stored is not distinct from v_default then
    raise notice 'PASS 3a: insert ignored client payment_instructions';
  else
    raise notice 'FAIL 3a: stored "%", expected business default "%"', v_stored, v_default;
  end if;

  -- UPDATE with a hostile value.
  update public.invoices
  set payment_instructions = 'HACKED-ON-UPDATE'
  where id = v_inv;

  select payment_instructions into v_stored
  from public.invoices where id = v_inv;

  if v_stored is not distinct from v_default then
    raise notice 'PASS 3b: update ignored client payment_instructions';
  else
    raise notice 'FAIL 3b: stored "%", expected business default "%"', v_stored, v_default;
  end if;
end $$;

rollback;

-- ===========================================================================
-- TEST 4: Issuing freezes payment_instructions_snapshot; later business
--         changes and direct tampering do not alter it.
-- ===========================================================================
begin;

do $$
declare
  v_biz uuid;
  v_default text;
  v_inv uuid;
  v_snap text;
  v_pay text;
begin
  select id, payment_instructions into v_biz, v_default
  from public.businesses limit 1;

  insert into public.invoices (business_id, invoice_number)
  values (v_biz, 'PAYTEST-002')
  returning id into v_inv;

  -- Draft: snapshot must be NULL.
  select payment_instructions_snapshot into v_snap
  from public.invoices where id = v_inv;
  if v_snap is null then
    raise notice 'PASS 4a: draft has no snapshot';
  else
    raise notice 'FAIL 4a: draft snapshot should be null, got "%"', v_snap;
  end if;

  -- Issue the invoice.
  update public.invoices set status = 'issued' where id = v_inv;

  select payment_instructions_snapshot, payment_instructions
  into v_snap, v_pay
  from public.invoices where id = v_inv;

  if v_snap is not distinct from v_default then
    raise notice 'PASS 4b: issue froze snapshot to business default';
  else
    raise notice 'FAIL 4b: snapshot "%", expected "%"', v_snap, v_default;
  end if;

  -- Owner changes the business default afterwards.
  update public.businesses
  set payment_instructions = 'NEW-DEFAULT-AFTER-ISSUE'
  where id = v_biz;

  select payment_instructions_snapshot, payment_instructions
  into v_snap, v_pay
  from public.invoices where id = v_inv;

  if v_snap is not distinct from v_default and v_pay is not distinct from v_default then
    raise notice 'PASS 4c: issued invoice kept original instructions after business change';
  else
    raise notice 'FAIL 4c: snapshot="%", pay="%", expected "%"', v_snap, v_pay, v_default;
  end if;

  -- Direct tampering attempt on the snapshot.
  update public.invoices
  set payment_instructions_snapshot = 'TAMPERED', payment_instructions = 'TAMPERED'
  where id = v_inv;

  select payment_instructions_snapshot, payment_instructions
  into v_snap, v_pay
  from public.invoices where id = v_inv;

  if v_snap is not distinct from v_default and v_pay is not distinct from v_default then
    raise notice 'PASS 4d: direct tampering with snapshot blocked';
  else
    raise notice 'FAIL 4d: tamper succeeded: snapshot="%", pay="%"', v_snap, v_pay;
  end if;
end $$;

rollback;
