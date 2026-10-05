-- 0018: Phase 2 — issuance snapshot, payments, audit trail, void, revisions.
--
-- Fits the live model: numbers are assigned at creation (assign_invoice_number),
-- issuance is the draft -> issued transition (markIssued / first print), and
-- payment-instruction freezing is already handled by 0016.

-- ============ invoice columns ============

alter table public.invoices
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  add column if not exists revision_of uuid references public.invoices(id) on delete set null,
  add column if not exists revision_no integer not null default 1,
  add column if not exists issued_pdf_path text,
  add column if not exists tax_breakdown jsonb not null default '[]';

create index if not exists invoices_revision_of_idx on public.invoices(revision_of);

-- ============ immutable issuance snapshot (server-side) ============
--
-- Fires on the draft -> issued transition and freezes everything the issued
-- document depends on: business identity, customer details, lines, commission
-- fields, totals, notes/terms, and payment instructions. Later edits to the
-- business, customer, catalog, or templates cannot alter an issued invoice.
-- The PDF, reprints, and re-emails render from this snapshot, never live data.

create or replace function public.freeze_invoice_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business jsonb;
  v_customer jsonb;
  v_lines jsonb;
  v_pay_instr text;
begin
  if not (NEW.status = 'issued' and OLD.status is distinct from 'issued' and NEW.snapshot is null) then
    return NEW;
  end if;

  select jsonb_build_object(
    'display_name', b.display_name,
    'legal_name', b.legal_name,
    'header_line', b.header_line,
    'logo_path', b.logo_path,
    'address_line1', b.address_line1,
    'address_line2', b.address_line2,
    'city', b.city, 'state', b.state, 'zip', b.zip,
    'phone', b.phone, 'email', b.email, 'website', b.website,
    'tax_id', b.tax_id
  ) into v_business
  from public.businesses b where b.id = NEW.business_id;

  select jsonb_build_object(
    'name', c.name,
    'company', c.company,
    'contact_person', c.contact_person,
    'billing_line1', c.billing_line1, 'billing_line2', c.billing_line2,
    'billing_city', c.billing_city, 'billing_state', c.billing_state, 'billing_zip', c.billing_zip,
    'email', c.email, 'phone', c.phone
  ) into v_customer
  from public.customers c where c.id = NEW.customer_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'position', l.position,
      'description', l.description,
      'quantity', l.quantity,
      'unit_label', l.unit_label,
      'unit_price_cents', l.unit_price_cents,
      'discount_cents', l.discount_cents,
      'tax_rate', l.tax_rate,
      'line_total_cents', l.line_total_cents
    ) order by l.position
  ), '[]'::jsonb) into v_lines
  from public.invoice_lines l where l.invoice_id = NEW.id;

  -- Payment instructions: prefer the 0016-frozen snapshot; fall back to the
  -- business default regardless of trigger firing order.
  v_pay_instr := coalesce(
    NEW.payment_instructions_snapshot,
    (select b2.payment_instructions from public.businesses b2 where b2.id = NEW.business_id)
  );

  NEW.snapshot := jsonb_build_object(
    'version', 2,
    'invoice_number', NEW.invoice_number,
    'template', NEW.template,
    'currency', NEW.currency,
    'invoice_date', NEW.invoice_date,
    'due_date', NEW.due_date,
    'po_number', NEW.po_number,
    'service_date', NEW.service_date,
    'service_period', NEW.service_period,
    'business', v_business,
    'customer', v_customer,
    'lines', v_lines,
    'commission', jsonb_build_object(
      'sale_price_cents', NEW.sale_price_cents,
      'commission_pct', NEW.commission_pct,
      'commission_amount_cents', NEW.commission_amount_cents,
      'processing_fee_cents', NEW.processing_fee_cents,
      'other_charge_desc', NEW.other_charge_desc,
      'other_charge_cents', NEW.other_charge_cents,
      'agent_name', NEW.agent_name,
      'second_agent_name', NEW.second_agent_name,
      'property_address', NEW.property_address
    ),
    'totals', jsonb_build_object(
      'subtotal_cents', NEW.subtotal_cents,
      'discount_cents', NEW.discount_cents,
      'tax_cents', NEW.tax_cents,
      'tax_by_rate', coalesce(NEW.tax_breakdown, '[]'::jsonb),
      'shipping_cents', NEW.shipping_cents,
      'total_cents', NEW.total_cents
    ),
    'notes', NEW.notes,
    'terms', NEW.terms,
    'payment_instructions', v_pay_instr,
    'issued_at', now()
  );

  return NEW;
end $$;

drop trigger if exists invoices_freeze_snapshot on public.invoices;
create trigger invoices_freeze_snapshot
  before update on public.invoices
  for each row execute function public.freeze_invoice_snapshot();

-- ============ payments ============

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  method text not null check (method in ('cash', 'check', 'bank_transfer', 'other')),
  reference text,
  note text,
  payment_date date not null default current_date,
  idempotency_key text not null,
  receipt_path text,
  reversed_at timestamptz,
  reversed_reason text,
  created_at timestamptz not null default now(),
  unique (invoice_id, idempotency_key)
);
create index payments_invoice_idx on public.payments(invoice_id);
create index payments_business_idx on public.payments(business_id);

alter table public.payments enable row level security;

drop policy if exists "payments member select" on public.payments;
create policy "payments member select"
  on public.payments for select to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id = payments.business_id and public.is_workspace_member(b.workspace_id)));
drop policy if exists "payments member insert" on public.payments;
create policy "payments member insert"
  on public.payments for insert to authenticated
  with check (exists (
    select 1 from public.businesses b
    where b.id = payments.business_id and public.is_workspace_member(b.workspace_id)));
drop policy if exists "payments member update" on public.payments;
create policy "payments member update"
  on public.payments for update to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id = payments.business_id and public.is_workspace_member(b.workspace_id)))
  with check (exists (
    select 1 from public.businesses b
    where b.id = payments.business_id and public.is_workspace_member(b.workspace_id)));
-- No delete policy: payments are reversed, never deleted.

-- Keep invoices.amount_paid_cents in sync (reversed payments excluded).
create or replace function public.refresh_amount_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv uuid;
  v_paid integer;
begin
  v_inv := coalesce(NEW.invoice_id, OLD.invoice_id);
  select coalesce(sum(amount_cents), 0) into v_paid
    from public.payments where invoice_id = v_inv and reversed_at is null;
  update public.invoices set amount_paid_cents = v_paid where id = v_inv;
  return coalesce(NEW, OLD);
end $$;

drop trigger if exists payments_refresh_paid on public.payments;
create trigger payments_refresh_paid
  after insert or update on public.payments
  for each row execute function public.refresh_amount_paid();

-- ============ audit trail (append-only) ============

create table if not exists public.audit_events (
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

drop policy if exists "audit member select" on public.audit_events;
create policy "audit member select"
  on public.audit_events for select to authenticated
  using (exists (
    select 1 from public.businesses b
    where b.id = audit_events.business_id and public.is_workspace_member(b.workspace_id)));
drop policy if exists "audit member insert" on public.audit_events;
create policy "audit member insert"
  on public.audit_events for insert to authenticated
  with check (exists (
    select 1 from public.businesses b
    where b.id = audit_events.business_id and public.is_workspace_member(b.workspace_id)));
-- No update/delete policies: the audit trail is append-only.

-- Record issuance in the audit trail alongside the snapshot freeze.
create or replace function public.audit_issuance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status = 'issued' and OLD.status is distinct from 'issued' then
    insert into public.audit_events (business_id, invoice_id, actor, action, details)
    values (NEW.business_id, NEW.id, auth.uid(), 'issued',
            jsonb_build_object('invoice_number', NEW.invoice_number));
  end if;
  return NEW;
end $$;

drop trigger if exists invoices_audit_issuance on public.invoices;
create trigger invoices_audit_issuance
  after update on public.invoices
  for each row execute function public.audit_issuance();

-- ============ private storage: issued PDFs and receipts ============

insert into storage.buckets (id, name, public)
values ('issued-pdfs', 'issued-pdfs', false),
       ('payment-receipts', 'payment-receipts', false)
on conflict (id) do nothing;

-- Object paths are <workspace_id>/<business_id>/... ; first segment is the workspace.
drop policy if exists "issued-pdfs member read" on storage.objects;
create policy "issued-pdfs member read"
  on storage.objects for select to authenticated
  using (bucket_id = 'issued-pdfs'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid));
drop policy if exists "issued-pdfs member write" on storage.objects;
create policy "issued-pdfs member write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'issued-pdfs'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid));

drop policy if exists "receipts member read" on storage.objects;
create policy "receipts member read"
  on storage.objects for select to authenticated
  using (bucket_id = 'payment-receipts'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid));
drop policy if exists "receipts member write" on storage.objects;
create policy "receipts member write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-receipts'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid));
