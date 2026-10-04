-- My Business Invoice Desk — Phase 2 schema
-- Issuance, atomic numbering, payments, reversals, revisions, audit trail.

-- ============ invoice additions ============

alter table public.invoices
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'partial', 'paid')),
  add column if not exists revised_from_id uuid references public.invoices(id) on delete set null,
  add column if not exists revision_no integer not null default 1,
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  add column if not exists issued_pdf_path text,
  add column if not exists template_id text not null default 'classic';

create index if not exists invoices_revised_from_idx on public.invoices(revised_from_id);

-- ============ payments ============

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  method text not null check (method in ('cash', 'check', 'bank_transfer', 'other')),
  reference text,
  note text,
  payment_date date not null default current_date,
  idempotency_key text not null,
  reversed_at timestamptz,
  reversed_reason text,
  created_at timestamptz not null default now(),
  unique (invoice_id, idempotency_key)
);
create index payments_invoice_idx on public.payments(invoice_id);
create index payments_business_idx on public.payments(business_id);

alter table public.payments enable row level security;

create policy "payments member select"
  on public.payments for select
  using (exists (
    select 1 from public.businesses b
    where b.id = payments.business_id and public.is_workspace_member(b.workspace_id)
  ));
create policy "payments member insert"
  on public.payments for insert
  with check (exists (
    select 1 from public.businesses b
    where b.id = payments.business_id and public.is_workspace_member(b.workspace_id)
  ));
create policy "payments member update"
  on public.payments for update
  using (exists (
    select 1 from public.businesses b
    where b.id = payments.business_id and public.is_workspace_member(b.workspace_id)
  ))
  with check (exists (
    select 1 from public.businesses b
    where b.id = payments.business_id and public.is_workspace_member(b.workspace_id)
  ));
-- No delete policy: payments are reversed, never deleted.

-- ============ audit trail (append-only) ============

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_invoice_idx on public.audit_events(invoice_id);
create index audit_business_idx on public.audit_events(business_id);

alter table public.audit_events enable row level security;

create policy "audit member select"
  on public.audit_events for select
  using (exists (
    select 1 from public.businesses b
    where b.id = audit_events.business_id and public.is_workspace_member(b.workspace_id)
  ));
create policy "audit member insert"
  on public.audit_events for insert
  with check (exists (
    select 1 from public.businesses b
    where b.id = audit_events.business_id and public.is_workspace_member(b.workspace_id)
  ));
-- No update/delete policies: the audit trail is append-only.

-- ============ payment status maintenance ============

create or replace function public.refresh_payment_status()
returns trigger
language plpgsql
security definer
as $$
declare
  v_inv uuid;
  v_total integer;
  v_paid integer;
  v_status text;
begin
  v_inv := coalesce(new.invoice_id, old.invoice_id);
  select total_cents into v_total from public.invoices where id = v_inv;
  select coalesce(sum(amount_cents), 0) into v_paid
    from public.payments where invoice_id = v_inv and reversed_at is null;
  v_status := case
    when v_paid <= 0 then 'unpaid'
    when v_paid < v_total then 'partial'
    else 'paid'
  end;
  update public.invoices
    set amount_paid_cents = v_paid, payment_status = v_status
    where id = v_inv;
  return coalesce(new, old);
end $$;

drop trigger if exists payments_refresh on public.payments;
create trigger payments_refresh
  after insert or update on public.payments
  for each row execute function public.refresh_payment_status();

-- ============ atomic issuance ============

create or replace function public.issue_invoice(p_invoice_id uuid, p_snapshot jsonb)
returns text
language plpgsql
security definer
as $$
declare
  v_business_id uuid;
  v_workspace_id uuid;
  v_prefix text;
  v_next integer;
  v_number text;
  v_status text;
begin
  select business_id, status into v_business_id, v_status
    from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only drafts can be issued.';
  end if;

  select workspace_id, invoice_prefix, next_number
    into v_workspace_id, v_prefix, v_next
    from public.businesses where id = v_business_id for update;

  if not public.is_workspace_member(v_workspace_id) then
    raise exception 'Not authorized.';
  end if;

  v_number := v_prefix || v_next::text;

  update public.businesses set next_number = v_next + 1 where id = v_business_id;

  update public.invoices
    set status = 'issued',
        invoice_number = v_number,
        issued_at = now(),
        snapshot = p_snapshot
    where id = p_invoice_id;

  insert into public.audit_events (business_id, invoice_id, actor, action, details)
    values (v_business_id, p_invoice_id, auth.uid(), 'issued',
            jsonb_build_object('invoice_number', v_number));

  return v_number;
end $$;

-- ============ private storage: issued PDFs and receipts ============

insert into storage.buckets (id, name, public)
values ('issued-pdfs', 'issued-pdfs', false),
       ('payment-receipts', 'payment-receipts', false)
on conflict (id) do nothing;

-- Object paths are <workspace_id>/<business_id>/... ; first folder segment is the workspace.
create policy "issued-pdfs member read"
  on storage.objects for select
  using (bucket_id = 'issued-pdfs' and public.is_workspace_member((storage.foldername(name))[1]::uuid));

create policy "issued-pdfs member write"
  on storage.objects for insert
  with check (bucket_id = 'issued-pdfs' and public.is_workspace_member((storage.foldername(name))[1]::uuid));

create policy "receipts member read"
  on storage.objects for select
  using (bucket_id = 'payment-receipts' and public.is_workspace_member((storage.foldername(name))[1]::uuid));

create policy "receipts member write"
  on storage.objects for insert
  with check (bucket_id = 'payment-receipts' and public.is_workspace_member((storage.foldername(name))[1]::uuid));
