-- Import the 25-item catalog from the legacy app into your
-- Kaleky Computer Consulting business. Run AFTER creating the business in the app.
with b as (
  select id from public.businesses
  where display_name ilike '%kaleky%computer%consulting%'
  limit 1
)
insert into public.items (business_id, name, default_rate_cents, unit_label, description)
select b.id, v.name, v.cents, v.unit, v.description
from b
cross join (values
  ('110 Patch Panel', 5500, 'each', 'Telephone Patch Panel'),
  ('30 Day late Fee', 1000, 'each', '30 Day late Fee'),
  ('Activate SpamExperts Email Filtering: covelaw.com', 299, 'each', null),
  ('Cat 3 Telephone', 4200, 'each', 'cat 3 wiring'),
  ('Cat 3 Telephone', 375, 'each', 'Levitan Inserts'),
  ('Cat 5 24 Port Patch Panel', 11000, 'each', 'Patch Panel'),
  ('cat 5 wiring', 6000, 'each', null),
  ('Dell all-n1', 45000, 'each', 'Dell - Inspiron 21.5" Touch-Screen All-In-One - AMD A6-Series - 4GB Memory - 1TB Hard Drive - Black'),
  ('Elite Pos', 4900, 'month', 'Essentials $49/Store/Month Unlimited Customers Unlimited Staff Accounts Unlimited Stations Unlimited SMS Support via Ticketing System and Knowledgebase Invoicing and Billing Customer Mobile App Racking Cash Management Customer Management Time card Dry Cleaning, Laundry, Alterations, Shoe Repair, & Retail'),
  ('Email Campaign', 10000, 'each', 'Email Campaign/upload 10k address/verify'),
  ('Email Hosting bluehost', 599, 'each', 'Mail hosting'),
  ('Face Plates', 250, 'each', '2 Port Face Plates'),
  ('LENOVO', 50000, 'each', 'Lenovo - IdeaCentre A340-22IGM 21.5" Touch-Screen All-In-One - Intel Pentium Silver - 4GB Memory - 1TB Hard Drive - Black'),
  ('Levitan Cat 5', 500, 'each', 'Catagory 5 Inserts'),
  ('Malwarebytes Business', 3900, 'each', 'Malwarebytes Discounted'),
  ('On-site Consulting', 12500, 'each', 'On Site Service and Consulting'),
  ('patch panel rack holder', 3700, 'each', 'Patch Panel holder'),
  ('Remote Consulting', 15000, 'each', 'Off Site Consulting Remote Control'),
  ('Remote Scan Client', 45300, 'each', 'Remote Scanning Client from Quest'),
  ('Remote Scan Maintenance per year', 9100, 'year', 'REMOTESCAN ENTERPRISE PER CONNECTED CLIENT MAINTENANCE RENEWAL'),
  ('Remote Scan Maintenance per year', 4800, 'year', 'REMOTESCAN ENTERPRISE PER CONNECTED CLIENT (2-19 CONNECTED CLIENT) MAINTENANCE RENEWAL'),
  ('Setup Fees POS', 25000, 'each', 'Setup Fee: $250 (Includes importing customers and price list, staff training session, hardware and payment integration setup, and basic customization.)'),
  ('Star Printer TSP650', 24000, 'each', 'https://posguys.com/receipt-pos-printer_12/Star-Micronics-TSP650II_2547USB'),
  ('TeamViewer Ver 15', 305400, 'each', 'TeamViewer License for 200 Manage Devices, 3 concurrent'),
  ('Windows 11 Pro Upgrade', 9900, 'each', 'Windows 11 Pro Upgrade from Microsoft Store')
) as v(name, cents, unit, description);
