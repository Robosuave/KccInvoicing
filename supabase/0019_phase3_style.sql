-- 0019: Phase 3 — visual invoice style default per business.
--
-- Note: businesses.default_template is the invoice TYPE ('standard' |
-- 'commission'). invoice_style is the VISUAL style used for PDFs/prints:
-- 'classic' (today's look), 'modern', or 'compact'.

alter table public.businesses
  add column if not exists invoice_style text not null default 'classic'
    check (invoice_style in ('classic', 'modern', 'compact'));
