# Legacy App Feature Map (reference only)

Screenshots of the user's current invoicing tool (imsgetpaidnow.com, "Invoicing Made Simple")
captured 2026-10-03 by the user as the screen walkthrough. These notes inform the new build's
feature set and import planning. The new app must have ORIGINAL branding/interface — do not copy
proprietary assets or branding from the legacy tool.

## Navigation (legacy)

- Top nav: Home, Customer, Settings, Log Out
- Settings sections: Items, Terms, Sales Tax, Company Information, Account Settings
- Footer: "© 2013 Invoicing Made Simple. All Rights Reserved."

## Home / dashboard (legacy)

- Search for customers by name to create an invoice ("Search For Customers By Name To Create Invoice Now")
- Find Invoices with three search modes: By Customer Name, By Invoice Date, By Invoice Number
- Search results list invoices with: Edit Invoice, Delete Invoice, Print Invoice buttons
- Search result entry shows: invoice number, customer name, phone, address

## Invoice editor (legacy)

Header/identity:
- Document type dropdown (INVOICE)
- Business block: name, address, city/state/zip, telephone, email (comes from Company Information)
- Date field, Invoice # (auto-incremented: observed #1213, #1214, #1215)
- Bill To: 3 free-text lines (name, address line, city/state/zip)
- Ship To: 3 free-text lines

Meta row:
- P.O. # (free text)
- Sales Person (free text)
- Terms (dropdown from Terms List, e.g. "Due upon receipt")
- Due Date

Line items:
- "Select Items" dropdown from item catalog
- Item Name, Unit Price, Quantity (default 1), Description
- "Add Item To Invoice" button
- Table columns: #, Description, Quantity, Price, Amount
- Decimal quantities supported (observed 33.3 x $150.00 = $4,995.00)

Totals:
- Subtotal
- Sales Tax checkbox + rate dropdown (e.g. 7.0% "Broward Tax"), amount line on PDF
- Shipping & Handling (amount field, default 0.00) — note: spec calls this "optional additional charge"
- Total Due

Footer / notes:
- Editable comments label ("Please click below to edit text" → "Comments:")
- Default comments: "Make checks payable to: ( Kaleky Computer Consulting Inc )" + contact block
- "Thank You For Your Business!" editable footer line
- Screenshot reference: legacy-screenshots/invoice-builder-bottom.jpg (2026-10-03) confirms the
  Subtotal / Sales Tax / Shipping & Handling / Total Due rows, the editable comments block with the
  company contact text, and the checked "Email To Customer" checkbox.

Actions:
- Save Invoice, Print Preview
- Email To Customer (checkbox + email), Email CC (checkbox + email), Email to self (checkbox + email)
- "Paid" checkbox (legacy uses a single Paid flag — spec replaces with payment states + payment records)

## Printed/PDF invoice (legacy)

- Business name/address/phone/email top-left, "INVOICE" top-right with Date and INVOICE #
- Bill To block
- P.O. # / Sales Person / Terms / Due Date row
- # / Description / Quantity / Unit Price / Amount table
- Subtotal, "Broward Tax 7.0%", Shipping & Handling, Total Due
- Comments section, "Thank You For Your Business!" footer bar

## Customers (legacy)

- Add New Customer form: Customer Full Name*, Street Address*, City*, State* (dropdown), Zip*,
  Fax (Optional), Primary Telephone*, Secondary Telephone (form may continue below fold)
- Customer list results: name, phone, address; actions: Create New Invoice, Edit, Delete
- Search For Customer by name

## Item catalog (legacy)

- Add Item form: Item Name*, Item Price*, Item Description (Optional) — "All * fields are required."
- Fields per item: name, unit price, description (observed: "110 Patch Panel" $55.00 / "Telephone Patch Panel";
  "30 Day late Fee" $10.00; "Activate SpamExperts Email Filtering: covelaw.com" $2.99; "Cat 3 Telephone" $42.00)
- Items List with Edit / Delete; "Add New Item"
- Dropdown "Select Items" on invoice editor; near-duplicates observed in legacy list (e.g. two "Cat 3 Telephone"
  entries that are actually different items: $42.00 "cat 3 wiring" vs $3.75 "Levitan Inserts"; two
  "Remote Scan Maintenance per year" entries that are different tiers: $91.00 single-client renewal vs $48 for
  2–19 clients) — import should flag similar names for review rather than silently deduping.

### Full legacy catalog as observed 2026-10-03 (25 items)

- 110 Patch Panel — $55.00 — Telephone Patch Panel
- 30 Day late Fee — $10.00 — 30 Day late Fee
- Activate SpamExperts Email Filtering: covelaw.com — $2.99 — (no description)
- Cat 3 Telephone — $42.00 — cat 3 wiring
- Cat 3 Telephone — $3.75 — Levitan Inserts
- Cat 5 24 Port Patch Panel — $110.00 — Patch Panel
- cat 5 wiring — $60.00 — (no description)
- Dell all-n1 — $450.00 — Dell - Inspiron 21.5" Touch-Screen All-In-One - AMD A6-Series - 4GB Memory - 1TB Hard Drive - Black
- Elite Pos — $49/month — Essentials $49/Store/Month Unlimited Customers Unlimited Staff Accounts Unlimited Stations Unlimited SMS Support via Ticketing System and Knowledgebase Invoicing and Billing Customer Mobile App Racking Cash Management Customer Management Time card Dry Cleaning, Laundry, Alterations, Shoe Repair, & Retail
- Email Campaign — $100 — Email Campaign/upload 10k address/verify
- Email Hosting bluehost — $5.99 — Mail hosting
- Face Plates — $2.50 — 2 Port Face Plates
- LENOVO — $500 — Lenovo - IdeaCentre A340-22IGM 21.5" Touch-Screen All-In-One - Intel Pentium Silver - 4GB Memory - 1TB Hard Drive - Black
- Levitan Cat 5 — $5.00 — Catagory 5 Inserts
- Malwarebytes Business — $39.00 — Malwarebytes Discounted
- On-site Consulting — $125.00 — On Site Service and Consulting
- patch panel rack holder — $37.00 — Patch Panel holder
- Remote Consulting — $150.00 — Off Site Consulting Remote Control
- Remote Scan Client — $453.00 — Remote Scanning Client from Quest
- Remote Scan Maintenance per year — $91.00 — REMOTESCAN ENTERPRISE PER CONNECTED CLIENT MAINTENANCE RENEWAL
- Remote Scan Maintenance per year — $48 — REMOTESCAN ENTERPRISE PER CONNECTED CLIENT (2-19 CONNECTED CLIENT) MAINTENANCE RENEWAL
- Setup Fees POS — $250.00 — Setup Fee: $250 (Includes importing customers and price list, staff training session, hardware and payment integration setup, and basic customization.)
- Star Printer TSP650 — $240.00 — https://posguys.com/receipt-pos-printer_12/Star-Micronics-TSP650II_2547USB
- TeamViewer Ver 15 — $3054 — TeamViewer License for 200 Manage Devices, 3 concurrent
- Windows 11 Pro Upgrade — $99.00 — Windows 11 Pro Upgrade from Microsoft Store

Note: prices include non-normalized values ($49/month, $3054, $48) — import should normalize and keep the original string for review.
- Item Description is optional on the Add Item form.

## Terms list (legacy)

- Add New Term; Terms List with Edit/Delete; observed term: "Due upon receipt"
- Terms dropdown on invoice editor

## Sales tax list (legacy)

- Add Sales Tax; list with Edit/Delete; observed: "Broward Tax" 7.0%
- Checkbox + dropdown on invoice editor

## Company Information (legacy)

- Company Name*, First Name*, Last Name*, Street Address*, City*, State* (dropdown), Zip*, Fax (Optional)
- Observed values: Kaleky Computer Consulting Inc / Rob Kaleky / 2800 N 46 Av A608 / Hollywood / Florida, FL / 33021

## Account Settings (legacy)

- Old/New password, Primary Email Address* (Robkaleky@gmail.com), Secondary Email Address,
  Paypal Email Address, Security Question* / Answer* ("What color" / "Purple")

## Notable behaviors / data observations

- Invoice numbering currently around #1213–1215 for this business — import must preserve sequence and not collide.
- Taxes: checkbox default OFF on editor; "Broward Tax 7.0%" prints as its own labeled line ($0.00 when not applied).
- Late fee is an item ("30 Day late Fee") rather than an automated feature.
- Email includes "Email to self" copy by default (checked).
- No multi-business concept in legacy; new build adds workspace/business layer on top.
- Legacy allows direct edit/delete of issued invoices — new build replaces with revision workflow per spec §5.
- Legacy "Paid" checkbox is a flat flag — new build uses payment records with states (unpaid/partial/paid) per spec §7.

## Migration notes (from user, 2026-10-03)

- The legacy app has NO export feature, so no CSV exports are coming. Plan changed: clients will be entered
  manually in the new app — the new app's customer entry must be fast (add-and-invoice flow).
- Items were transcribed from the user's screenshots into seed-items.csv (25 items, unit label "month"/"year"
  where applicable). Ready for one-shot import once Phase 5 import is built.
- Import CSV mapping design (for Phase 5) still applies as a new-app feature per SPEC.md §13.
