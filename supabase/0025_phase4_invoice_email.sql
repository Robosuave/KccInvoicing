-- 0025_phase4_invoice_email.sql
-- Phase 4: email integration. Tracks every invoice email sent through the app
-- plus delivery/open/bounce status reported back by the provider webhook.
-- Safe to re-run (IF NOT EXISTS / DROP IF EXISTS guards throughout).

-- Per-business sender address, e.g. billing@daniarealtyinc.com.
alter table public.businesses
  add column if not exists email_from text;

create table if not exists public.invoice_emails (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  to_email text not null,
  from_email text not null,
  subject text not null default '',
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'opened', 'bounced', 'failed')),
  provider text not null default 'resend',
  provider_message_id text,
  error text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz
);

create index if not exists invoice_emails_invoice_id_idx on public.invoice_emails (invoice_id);
create index if not exists invoice_emails_provider_msg_idx on public.invoice_emails (provider_message_id);

alter table public.invoice_emails enable row level security;

-- Reads: the sender sees their own rows; workspace owners see everything.
drop policy if exists "invoice_emails_select" on public.invoice_emails;
create policy "invoice_emails_select" on public.invoice_emails
  for select to authenticated
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.workspace_members wm
      where wm.user_id = auth.uid() and wm.role = 'owner'
    )
  );

-- Writes happen from the send-invoice-email edge function under the service
-- role (bypasses RLS). No direct INSERT/UPDATE/DELETE for app users.
drop policy if exists "invoice_emails_no_direct_write" on public.invoice_emails;
create policy "invoice_emails_no_direct_write" on public.invoice_emails
  for all to authenticated
  using (false)
  with check (false);
