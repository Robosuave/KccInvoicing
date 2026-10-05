-- Delete ALL invoices (test data cleanup).
-- Run this in the Supabase SQL Editor.
-- WARNING: This is permanent and cannot be undone.

-- Delete child records first (payments, audit events, lines).
delete from public.payments;
delete from public.audit_events;
delete from public.invoice_lines;

-- Delete all invoices.
delete from public.invoices;

-- Optional: reset the invoice number counter.
-- Uncomment the business you want to reset (or run both).
-- update public.businesses set next_number = 600 where display_name = 'Dania Realty. Inc';
-- update public.businesses set next_number = 1 where display_name = 'Kaleky Computer Consulting Inc';

notify pgrst, 'reload schema';
