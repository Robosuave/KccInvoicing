-- Seed the 26-item catalog for a business.
-- Usage: replace 'YOUR_BUSINESS_ID' with the business uuid, then run in Supabase SQL editor.
-- Safe to re-run: skips items whose name already exists for that business.

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', '110 Patch Panel', 5500, 'each', 'Telephone Patch Panel'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = '110 Patch Panel');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', '30 Day late Fee', 1000, 'each', '30 Day late Fee'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = '30 Day late Fee');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'Activate SpamExperts Email Filtering: covelaw.com', 299, 'each', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'Activate SpamExperts Email Filtering: covelaw.com');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'Cat 3 Telephone', 4200, 'each', 'cat 3 wiring'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'Cat 3 Telephone');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'Cat 3 Telephone', 375, 'each', 'Levitan Inserts'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'Cat 3 Telephone');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'Cat 5 24 Port Patch Panel', 11000, 'each', 'Patch Panel'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'Cat 5 24 Port Patch Panel');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'cat 5 wiring', 6000, 'each', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'cat 5 wiring');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'Dell all-n1', 45000, 'each', 'Dell - Inspiron 21.5" Touch-Screen All-In-One - AMD A6-Series - 4GB Memory - 1TB Hard Drive - Black'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'Dell all-n1');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'Elite Pos', 4900, 'month', 'Essentials $49/Store/Month Unlimited Customers Unlimited Staff Accounts Unlimited Stations Unlimited SMS Support via Ticketing System and Knowledgebase Invoicing and Billing Customer Mobile App Racking Cash Management Customer Management Time card Dry Cleaning, Laundry, Alterations, Shoe Repair, & Retail'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'Elite Pos');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'Email Campaign', 10000, 'each', 'Email Campaign/upload 10k address/verify'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'Email Campaign');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'Email Hosting bluehost', 599, 'each', 'Mail hosting'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'Email Hosting bluehost');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'Face Plates', 250, 'each', '2 Port Face Plates'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'Face Plates');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'LENOVO', 50000, 'each', 'Lenovo - IdeaCentre A340-22IGM 21.5" Touch-Screen All-In-One - Intel Pentium Silver - 4GB Memory - 1TB Hard Drive - Black'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'LENOVO');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'Levitan Cat 5', 500, 'each', 'Catagory 5 Inserts'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'Levitan Cat 5');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'Malwarebytes Business', 3900, 'each', 'Malwarebytes Discounted'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'Malwarebytes Business');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'On-site Consulting', 12500, 'each', 'On Site Service and Consulting'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'On-site Consulting');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'patch panel rack holder', 3700, 'each', 'Patch Panel holder'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'patch panel rack holder');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'Remote Consulting', 15000, 'each', 'Off Site Consulting Remote Control'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'Remote Consulting');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'Remote Scan Client', 45300, 'each', 'Remote Scanning Client from Quest'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'Remote Scan Client');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'Remote Scan Maintenance per year', 9100, 'year', 'REMOTESCAN ENTERPRISE PER CONNECTED CLIENT MAINTENANCE RENEWAL'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'Remote Scan Maintenance per year');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'Remote Scan Maintenance per year', 4800, 'year', 'REMOTESCAN ENTERPRISE PER CONNECTED CLIENT (2-19 CONNECTED CLIENT) MAINTENANCE RENEWAL'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'Remote Scan Maintenance per year');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'Setup Fees POS', 25000, 'each', 'Setup Fee: $250 (Includes importing customers and price list, staff training session, hardware and payment integration setup, and basic customization.)'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'Setup Fees POS');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'Star Printer TSP650', 24000, 'each', 'https://posguys.com/receipt-pos-printer_12/Star-Micronics-TSP650II_2547USB'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'Star Printer TSP650');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'TeamViewer Ver 15', 305400, 'each', 'TeamViewer License for 200 Manage Devices, 3 concurrent'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'TeamViewer Ver 15');

INSERT INTO public.items (business_id, name, default_rate_cents, unit_label, description)
SELECT 'YOUR_BUSINESS_ID', 'Windows 11 Pro Upgrade', 9900, 'each', 'Windows 11 Pro Upgrade from Microsoft Store'
WHERE NOT EXISTS (SELECT 1 FROM public.items WHERE business_id = 'YOUR_BUSINESS_ID' AND name = 'Windows 11 Pro Upgrade');
