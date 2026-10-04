-- 0007: per-business team access. Agents are invited by email to ONE business
-- (e.g. Dania Realty Inc) and can only see and invoice for that business.
-- The workspace owner keeps full access to every business.

-- ============ role: allow 'agent' on workspace_members ============

alter table public.workspace_members
  drop constraint if exists workspace_members_role_check;
alter table public.workspace_members
  add constraint workspace_members_role_check check (role in ('owner', 'agent'));

-- ============ tables ============

create table public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'agent' check (role in ('owner', 'agent')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table public.business_invites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (business_id, email)
);

-- ============ helpers ============

create or replace function public.is_workspace_owner(w_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = w_id and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- A user can access a business when they are the workspace owner,
-- or they hold an explicit membership on that business.
create or replace function public.can_access_business(b_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
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
$$;

-- Redeem pending email invites for the signed-in user. Runs as the
-- function owner so it can join businesses and write memberships.
create or replace function public.redeem_my_invites()
returns integer
language plpgsql
security definer
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
    select i.business_id, b.workspace_id
    from public.business_invites i
    join public.businesses b on b.id = i.business_id
    where lower(i.email) = u_email
  loop
    insert into public.workspace_members (workspace_id, user_id, role)
    values (r.workspace_id, u_id, 'agent')
    on conflict (workspace_id, user_id) do nothing;

    insert into public.business_members (business_id, user_id, email, role)
    values (r.business_id, u_id, u_email, 'agent')
    on conflict (business_id, user_id) do nothing;

    delete from public.business_invites
    where business_id = r.business_id and lower(email) = u_email;

    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ============ atomic invoice number assignment ============
-- Agents cannot UPDATE businesses (owner-only), so number assignment moves
-- into this security-definer function. It also closes a race where two
-- invoices created at once could grab the same number.

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
  select b.invoice_prefix, b.next_number into pfx, num
  from public.businesses b
  where b.id = b_id
  for update;
  if num is null then
    raise exception 'Business not found.';
  end if;
  update public.businesses set next_number = num + 1 where id = b_id;
  return coalesce(pfx, '') || num::text;
end;
$$;

alter table public.business_members enable row level security;
alter table public.business_invites enable row level security;

create policy "business_members self read"
  on public.business_members for select
  using (user_id = auth.uid());

create policy "business_members owner read"
  on public.business_members for select
  using (exists (
    select 1 from public.businesses b
    where b.id = business_members.business_id
      and public.is_workspace_owner(b.workspace_id)
  ));

create policy "business_members owner manage"
  on public.business_members for all
  using (exists (
    select 1 from public.businesses b
    where b.id = business_members.business_id
      and public.is_workspace_owner(b.workspace_id)
  ))
  with check (exists (
    select 1 from public.businesses b
    where b.id = business_members.business_id
      and public.is_workspace_owner(b.workspace_id)
  ));

create policy "business_invites owner read"
  on public.business_invites for select
  using (exists (
    select 1 from public.businesses b
    where b.id = business_invites.business_id
      and public.is_workspace_owner(b.workspace_id)
  ));

create policy "business_invites self read"
  on public.business_invites for select
  using (lower(email) = lower(auth.jwt() ->> 'email'));

create policy "business_invites owner insert"
  on public.business_invites for insert
  with check (exists (
    select 1 from public.businesses b
    where b.id = business_invites.business_id
      and public.is_workspace_owner(b.workspace_id)
  ));

create policy "business_invites owner delete"
  on public.business_invites for delete
  using (exists (
    select 1 from public.businesses b
    where b.id = business_invites.business_id
      and public.is_workspace_owner(b.workspace_id)
  ));

-- ============ tighten existing policies to business-level access ============

-- businesses: members see only their businesses; only the owner manages them
drop policy if exists "businesses member select" on public.businesses;
create policy "businesses access select"
  on public.businesses for select
  using (public.can_access_business(id));

drop policy if exists "businesses member insert" on public.businesses;
create policy "businesses owner insert"
  on public.businesses for insert
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists "businesses member update" on public.businesses;
create policy "businesses owner update"
  on public.businesses for update
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

drop policy if exists "businesses member delete" on public.businesses;
create policy "businesses owner delete"
  on public.businesses for delete
  using (public.is_workspace_owner(workspace_id));

-- customers
drop policy if exists "customers member select" on public.customers;
drop policy if exists "customers member insert" on public.customers;
drop policy if exists "customers member update" on public.customers;
drop policy if exists "customers member delete" on public.customers;
create policy "customers access select"
  on public.customers for select
  using (exists (
    select 1 from public.businesses b
    where b.id = customers.business_id and public.can_access_business(b.id)
  ));
create policy "customers access insert"
  on public.customers for insert
  with check (exists (
    select 1 from public.businesses b
    where b.id = customers.business_id and public.can_access_business(b.id)
  ));
create policy "customers access update"
  on public.customers for update
  using (exists (
    select 1 from public.businesses b
    where b.id = customers.business_id and public.can_access_business(b.id)
  ))
  with check (exists (
    select 1 from public.businesses b
    where b.id = customers.business_id and public.can_access_business(b.id)
  ));
create policy "customers access delete"
  on public.customers for delete
  using (exists (
    select 1 from public.businesses b
    where b.id = customers.business_id and public.can_access_business(b.id)
  ));

-- items
drop policy if exists "items member select" on public.items;
drop policy if exists "items member insert" on public.items;
drop policy if exists "items member update" on public.items;
drop policy if exists "items member delete" on public.items;
create policy "items access select"
  on public.items for select
  using (exists (
    select 1 from public.businesses b
    where b.id = items.business_id and public.can_access_business(b.id)
  ));
create policy "items access insert"
  on public.items for insert
  with check (exists (
    select 1 from public.businesses b
    where b.id = items.business_id and public.can_access_business(b.id)
  ));
create policy "items access update"
  on public.items for update
  using (exists (
    select 1 from public.businesses b
    where b.id = items.business_id and public.can_access_business(b.id)
  ))
  with check (exists (
    select 1 from public.businesses b
    where b.id = items.business_id and public.can_access_business(b.id)
  ));
create policy "items access delete"
  on public.items for delete
  using (exists (
    select 1 from public.businesses b
    where b.id = items.business_id and public.can_access_business(b.id)
  ));

-- invoices
drop policy if exists "invoices member select" on public.invoices;
drop policy if exists "invoices member insert" on public.invoices;
drop policy if exists "invoices member update" on public.invoices;
drop policy if exists "invoices member delete" on public.invoices;
create policy "invoices access select"
  on public.invoices for select
  using (exists (
    select 1 from public.businesses b
    where b.id = invoices.business_id and public.can_access_business(b.id)
  ));
create policy "invoices access insert"
  on public.invoices for insert
  with check (exists (
    select 1 from public.businesses b
    where b.id = invoices.business_id and public.can_access_business(b.id)
  ));
create policy "invoices access update"
  on public.invoices for update
  using (exists (
    select 1 from public.businesses b
    where b.id = invoices.business_id and public.can_access_business(b.id)
  ))
  with check (exists (
    select 1 from public.businesses b
    where b.id = invoices.business_id and public.can_access_business(b.id)
  ));
create policy "invoices access delete"
  on public.invoices for delete
  using (exists (
    select 1 from public.businesses b
    where b.id = invoices.business_id and public.can_access_business(b.id)
  ));

-- invoice lines
drop policy if exists "lines member all" on public.invoice_lines;
create policy "lines access all"
  on public.invoice_lines for all
  using (exists (
    select 1 from public.invoices i
    join public.businesses b on b.id = i.business_id
    where i.id = invoice_lines.invoice_id and public.can_access_business(b.id)
  ))
  with check (exists (
    select 1 from public.invoices i
    join public.businesses b on b.id = i.business_id
    where i.id = invoice_lines.invoice_id and public.can_access_business(b.id)
  ));
