-- 0028: consolidated agent-access repair (idempotent).
--
-- Root cause of "agent sees Create business instead of their assigned business":
-- 0014 reverted the 0007 agent model, and the follow-up chain
-- (0015/0020/0021/0022/0023/0024) was never fully applied. Without
-- redeem_my_invites() the invite is never redeemed on login, so the agent
-- ends up as owner of their own empty workspace.
--
-- This script is safe to run on ANY database state: every statement is
-- guarded (IF NOT EXISTS / DROP IF EXISTS / CREATE OR REPLACE), so it
-- repairs partial applies without touching working objects.
--
-- Also fixes two gaps found while diagnosing:
--   a) "business_members self read" was never restored after 0014, so an
--      agent could not read their own membership rows (ensureWorkspace fell
--      through to creating an orphan workspace).
--   b) invoice/customer/item INSERT policies required workspace membership,
--      which would block agents (business_members only) from creating
--      invoices at all. Agents can still NOT create businesses.

-- ============ 1. tables ============
create table if not exists public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'agent' check (role in ('owner', 'agent')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table if not exists public.business_invites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (business_id, email)
);

alter table public.business_members enable row level security;
alter table public.business_invites enable row level security;

-- created_by on invoices (stamped by trigger, cannot be spoofed)
alter table public.invoices
  add column if not exists created_by uuid references auth.users(id);

-- ============ 2. helper functions ============
-- plpgsql (never inlined) so SECURITY DEFINER is honored (see 0012).
create or replace function public.is_business_member(b_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1 from public.business_members m
    where m.business_id = b_id and m.user_id = auth.uid()
  );
end;
$$;

-- Owner sees all invoices in accessible businesses; everyone else
-- (including agents) sees only invoices they created.
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
      and (
        (public.is_workspace_member(b.workspace_id)
         and (public.is_workspace_owner(b.workspace_id) or i.created_by = auth.uid()))
        or (public.is_business_member(b.id) and i.created_by = auth.uid())
      )
  );
end;
$$;

create or replace function public.set_invoice_created_by()
returns trigger
language plpgsql
as $$
begin
  NEW.created_by := auth.uid();
  return NEW;
end;
$$;

drop trigger if exists invoices_set_created_by on public.invoices;
create trigger invoices_set_created_by
  before insert on public.invoices
  for each row execute function public.set_invoice_created_by();

-- Invite redemption (runs on every login). Agents join business_members ONLY,
-- never workspace_members, so they see just their assigned business.
create or replace function public.redeem_my_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  r record;
  u_email text := lower(auth.jwt() ->> 'email');
  u_id uuid := auth.uid();
begin
  if u_id is null or u_email is null then
    return 0;
  end if;
  for r in
    select i.id as invite_id, i.business_id
    from public.business_invites i
    where lower(i.email) = u_email
  loop
    insert into public.business_members (business_id, user_id, email, role)
    values (r.business_id, u_id, u_email, 'agent')
    on conflict (business_id, user_id) do nothing;

    delete from public.business_invites where id = r.invite_id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ============ 3. RLS policies ============
-- business_members: agents must be able to read their OWN rows
-- (this policy was lost in the 0014 revert and never restored).
drop policy if exists "business_members self read" on public.business_members;
create policy "business_members self read" on public.business_members
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "business_members member read" on public.business_members;
create policy "business_members member read" on public.business_members
  for select to authenticated using (exists (
    select 1 from public.businesses b
    where b.id = business_members.business_id
      and public.is_workspace_member(b.workspace_id)));
drop policy if exists "business_members member manage" on public.business_members;
create policy "business_members member manage" on public.business_members
  for all to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id = business_members.business_id
      and public.is_workspace_member(b.workspace_id)))
  with check (exists (
    select 1 from public.businesses b
    where b.id = business_members.business_id
      and public.is_workspace_member(b.workspace_id)));

-- business_invites: owner invites / cancels / lists
drop policy if exists "business_invites member read" on public.business_invites;
create policy "business_invites member read" on public.business_invites
  for select to authenticated using (exists (
    select 1 from public.businesses b
    where b.id = business_invites.business_id
      and public.is_workspace_member(b.workspace_id)));
drop policy if exists "business_invites member insert" on public.business_invites;
create policy "business_invites member insert" on public.business_invites
  for insert to authenticated with check (exists (
    select 1 from public.businesses b
    where b.id = business_invites.business_id
      and public.is_workspace_member(b.workspace_id)));
drop policy if exists "business_invites member delete" on public.business_invites;
create policy "business_invites member delete" on public.business_invites
  for delete to authenticated using (exists (
    select 1 from public.businesses b
    where b.id = business_invites.business_id
      and public.is_workspace_member(b.workspace_id)));

-- businesses: agents can SELECT their assigned business.
-- INSERT/UPDATE/DELETE stay workspace-member-only, so agents can NOT
-- create businesses (standing rule).
drop policy if exists "businesses member select" on public.businesses;
create policy "businesses member select" on public.businesses
  for select to authenticated using (
    public.is_workspace_member(workspace_id)
    or public.is_business_member(businesses.id)
  );

-- invoices: owner sees all; agents see/create only their own
drop policy if exists "invoices member select" on public.invoices;
drop policy if exists "invoices owner-or-creator select" on public.invoices;
create policy "invoices owner-or-creator select"
  on public.invoices for select to authenticated
  using (public.can_access_invoice(id));

drop policy if exists "invoices member insert" on public.invoices;
create policy "invoices member insert"
  on public.invoices for insert to authenticated
  with check (exists (
    select 1 from public.businesses b
    where b.id = invoices.business_id
      and (public.is_workspace_member(b.workspace_id) or public.is_business_member(b.id))
  ));

drop policy if exists "invoices owner-or-creator update" on public.invoices;
drop policy if exists "invoices member update" on public.invoices;
create policy "invoices owner-or-creator update"
  on public.invoices for update to authenticated
  using (public.can_access_invoice(id))
  with check (exists (
    select 1 from public.businesses b
    where b.id = invoices.business_id
      and (public.is_workspace_member(b.workspace_id) or public.is_business_member(b.id))
  ));

drop policy if exists "invoices member delete" on public.invoices;
drop policy if exists "invoices owner-or-creator delete" on public.invoices;
create policy "invoices owner-or-creator delete"
  on public.invoices for delete to authenticated
  using (public.can_access_invoice(id));

-- invoice lines follow the parent invoice
drop policy if exists "lines member all" on public.invoice_lines;
drop policy if exists "lines owner-or-creator all" on public.invoice_lines;
create policy "lines owner-or-creator all"
  on public.invoice_lines for all to authenticated
  using (public.can_access_invoice(invoice_id))
  with check (public.can_access_invoice(invoice_id));

-- customers: shared; agents can select + insert (invoice quick-add)
drop policy if exists "customers member select" on public.customers;
create policy "customers member select" on public.customers
  for select to authenticated using (exists (
    select 1 from public.businesses b
    where b.id = customers.business_id
      and (public.is_workspace_member(b.workspace_id) or public.is_business_member(b.id))
  ));
drop policy if exists "customers member insert" on public.customers;
create policy "customers member insert" on public.customers
  for insert to authenticated with check (exists (
    select 1 from public.businesses b
    where b.id = customers.business_id
      and (public.is_workspace_member(b.workspace_id) or public.is_business_member(b.id))
  ));

-- items (catalog): same as customers
drop policy if exists "items member select" on public.items;
create policy "items member select" on public.items
  for select to authenticated using (exists (
    select 1 from public.businesses b
    where b.id = items.business_id
      and (public.is_workspace_member(b.workspace_id) or public.is_business_member(b.id))
  ));
drop policy if exists "items member insert" on public.items;
create policy "items member insert" on public.items
  for insert to authenticated with check (exists (
    select 1 from public.businesses b
    where b.id = items.business_id
      and (public.is_workspace_member(b.workspace_id) or public.is_business_member(b.id))
  ));

notify pgrst, 'reload schema';
