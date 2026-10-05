-- 0026_invoice_timesheet.sql
-- Timesheet PDF attachment per invoice. The timesheet is stored in private
-- storage and attached alongside the invoice PDF when emailing (Phase 4).
-- Safe to re-run (IF NOT EXISTS / DROP IF EXISTS guards throughout).

alter table public.invoices
  add column if not exists timesheet_path text;

-- Record whether the timesheet rode along on a sent email.
alter table public.invoice_emails
  add column if not exists timesheet_included boolean not null default false;

-- Private bucket for timesheets (and future invoice attachments).
insert into storage.buckets (id, name, public)
values ('invoice-attachments', 'invoice-attachments', false)
on conflict (id) do nothing;

-- Object paths are <workspace_id>/<business_id>/<invoice_id>/timesheet.pdf ;
-- first segment is the workspace, mirroring the issued-pdfs convention.
drop policy if exists "attachments member read" on storage.objects;
create policy "attachments member read"
  on storage.objects for select to authenticated
  using (bucket_id = 'invoice-attachments'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid));
drop policy if exists "attachments member write" on storage.objects;
create policy "attachments member write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'invoice-attachments'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid));
drop policy if exists "attachments member delete" on storage.objects;
create policy "attachments member delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'invoice-attachments'
    and public.is_workspace_member((storage.foldername(name))[1]::uuid));
