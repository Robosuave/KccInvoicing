-- My Business Invoice Desk — Phase 3 schema
-- Template selection. (PDFs themselves live in the issued-pdfs / payment-receipts
-- buckets created in 0002; paths are stored on invoices / payments.)

alter table public.businesses
  add column if not exists default_template_id text not null default 'classic'
    check (default_template_id in ('classic', 'modern', 'compact'));

alter table public.payments
  add column if not exists receipt_path text;
