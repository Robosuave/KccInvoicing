-- My Business Invoice Desk — Phase 1 schema
-- Run with: supabase db push (or apply via Supabase SQL editor)
-- Phase 1 scope: workspaces, businesses, customers, items, draft invoices + lines.
-- Issuance/numbering function, payments, audit trail, templates arrive in Phase 2.


-- ============ workspaces ============

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My Workspace',
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- ============ helpers ============

create or replace function public.is_workspace_member(w_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = w_id and m.user_id = auth.uid()
  );
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy "members can read own workspaces"
  on public.workspaces for select
  using (public.is_workspace_member(id));

create policy "members can read own memberships"
  on public.workspace_members for select
  using (user_id = auth.uid());

-- ============ businesses ============

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null,
  legal_name text,
  logo_path text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip text,
  phone text,
  email text,
  website text,
  tax_id text,
  currency char(3) not null default 'USD',
  payment_terms text not null default 'Due upon receipt',
  invoice_notes text,
  payment_instructions text,
  invoice_prefix text not null default '',
  next_number integer not null default 1 check (next_number >= 1),
  default_tax_rate numeric(5,4) not null default 0,
  default_email_subject text,
  default_email_message text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.businesses enable row level security;

create policy "businesses member select"
  on public.businesses for select
  using (public.is_workspace_member(workspace_id));
create policy "businesses member insert"
  on public.businesses for insert
  with check (public.is_workspace_member(workspace_id));
create policy "businesses member update"
  on public.businesses for update
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));
create policy "businesses member delete"
  on public.businesses for delete
  using (public.is_workspace_member(workspace_id));

-- ============ customers ============

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  contact_person text,
  billing_line1 text,
  billing_line2 text,
  billing_city text,
  billing_state text,
  billing_zip text,
  email text,
  phone text,
  shipping_line1 text,
  shipping_line2 text,
  shipping_city text,
  shipping_state text,
  shipping_zip text,
  notes text,
  default_payment_terms text,
  tax_exempt boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_business_idx on public.customers(business_id);

alter table public.customers enable row level security;

create policy "customers member select"
  on public.customers for select
  using (exists (
    select 1 from public.businesses b
    where b.id = customers.business_id and public.is_workspace_member(b.workspace_id)
  ));
create policy "customers member insert"
  on public.customers for insert
  with check (exists (
    select 1 from public.businesses b
    where b.id = customers.business_id and public.is_workspace_member(b.workspace_id)
  ));
create policy "customers member update"
  on public.customers for update
  using (exists (
    select 1 from public.businesses b
    where b.id = customers.business_id and public.is_workspace_member(b.workspace_id)
  ));
create policy "customers member delete"
  on public.customers for delete
  using (exists (
    select 1 from public.businesses b
    where b.id = customers.business_id and public.is_workspace_member(b.workspace_id)
  ));

-- ============ items (products & services catalog) ============

create table public.items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  description text,
  item_code text,
  unit_label text not null default 'each',
  default_rate_cents integer not null default 0 check (default_rate_cents >= 0),
  default_tax_rate numeric(5,4) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index items_business_idx on public.items(business_id);

alter table public.items enable row level security;

create policy "items member select"
  on public.items for select
  using (exists (
    select 1 from public.businesses b
    where b.id = items.business_id and public.is_workspace_member(b.workspace_id)
  ));
create policy "items member insert"
  on public.items for insert
  with check (exists (
    select 1 from public.businesses b
    where b.id = items.business_id and public.is_workspace_member(b.workspace_id)
  ));
create policy "items member update"
  on public.items for update
  using (exists (
    select 1 from public.businesses b
    where b.id = items.business_id and public.is_workspace_member(b.workspace_id)
  ));
create policy "items member delete"
  on public.items for delete
  using (exists (
    select 1 from public.businesses b
    where b.id = items.business_id and public.is_workspace_member(b.workspace_id)
  ));

-- ============ invoices (Phase 1: drafts) ============

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','issued','void')),
  invoice_number text,               -- assigned atomically at issuance (Phase 2)
  draft_key text not null default 'draft-' || substr(gen_random_uuid()::text, 1, 8),
  invoice_date date not null default current_date,
  due_date date,
  po_number text,
  service_date date,
  service_period text,
  currency char(3) not null default 'USD',
  subtotal_cents integer not null default 0,
  discount_cents integer not null default 0,
  tax_cents integer not null default 0,
  shipping_cents integer not null default 0,
  total_cents integer not null default 0,
  amount_paid_cents integer not null default 0,
  notes text,
  terms text,
  payment_instructions text,
  snapshot jsonb,                    -- immutable snapshot written at issuance (Phase 2)
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, invoice_number)
);
create index invoices_business_idx on public.invoices(business_id);
create index invoices_customer_idx on public.invoices(customer_id);

alter table public.invoices enable row level security;

create policy "invoices member select"
  on public.invoices for select
  using (exists (
    select 1 from public.businesses b
    where b.id = invoices.business_id and public.is_workspace_member(b.workspace_id)
  ));
create policy "invoices member insert"
  on public.invoices for insert
  with check (exists (
    select 1 from public.businesses b
    where b.id = invoices.business_id and public.is_workspace_member(b.workspace_id)
  ));
create policy "invoices member update"
  on public.invoices for update
  using (exists (
    select 1 from public.businesses b
    where b.id = invoices.business_id and public.is_workspace_member(b.workspace_id)
  ));
create policy "invoices member delete"
  on public.invoices for delete
  using (exists (
    select 1 from public.businesses b
    where b.id = invoices.business_id and public.is_workspace_member(b.workspace_id)
  ));

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  position integer not null default 0,
  item_id uuid references public.items(id) on delete set null,
  description text not null,
  quantity numeric(14,4) not null default 1 check (quantity > 0),
  unit_label text not null default 'each',
  unit_price_cents integer not null default 0 check (unit_price_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  tax_rate numeric(5,4) not null default 0,
  line_total_cents integer not null default 0,
  created_at timestamptz not null default now()
);
create index invoice_lines_invoice_idx on public.invoice_lines(invoice_id);

alter table public.invoice_lines enable row level security;

create policy "lines member all"
  on public.invoice_lines for all
  using (exists (
    select 1 from public.invoices i
    join public.businesses b on b.id = i.business_id
    where i.id = invoice_lines.invoice_id and public.is_workspace_member(b.workspace_id)
  ))
  with check (exists (
    select 1 from public.invoices i
    join public.businesses b on b.id = i.business_id
    where i.id = invoice_lines.invoice_id and public.is_workspace_member(b.workspace_id)
  ));

-- ============ private storage: business logos ============

insert into storage.buckets (id, name, public)
values ('business-logos', 'business-logos', false)
on conflict (id) do nothing;

create policy "logos member read"
  on storage.objects for select
  using (bucket_id = 'business-logos' and public.is_workspace_member((storage.foldername(name))[1]::uuid));

create policy "logos member write"
  on storage.objects for insert
  with check (bucket_id = 'business-logos' and public.is_workspace_member((storage.foldername(name))[1]::uuid));

create policy "logos member delete"
  on storage.objects for delete
  using (bucket_id = 'business-logos' and public.is_workspace_member((storage.foldername(name))[1]::uuid));

-- ============ updated_at trigger ============

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger businesses_touch before update on public.businesses
  for each row execute function public.touch_updated_at();
create trigger customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();
create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();
create trigger invoices_touch before update on public.invoices
  for each row execute function public.touch_updated_at();
