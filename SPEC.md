# My Business Invoice Desk — Build Specification

Working name: My Business Invoice Desk. Make the name easy to change.

Spec as pasted by the user on 2026-10-03. This is the source of truth for the build.

## PROJECT PURPOSE

Build a simple, reliable invoicing application for a home-business owner who operates several separate businesses.

He likes his current invoicing software's straightforward workflow, but wants:
1. Multiple business identities within one login.
2. Professional PDF downloads, printing, and easy email sharing.
3. Permanent, searchable records of past invoices.
4. The ability to edit invoice contents, customize the invoicing screen, and customize invoice templates.
5. Ownership and portability of his data and application.

This must be a functional application, not a landing page, static prototype, or collection of nonworking buttons.

Create an original interface and branding. Do not copy another product's source code, proprietary assets, or branding.

## CORE PRODUCT PRINCIPLES

- Keep the everyday workflow extremely simple.
- Prioritize reliable invoices and data integrity over extra features.
- Use clear labels, readable text, large click targets, and helpful error messages.
- Support desktop, tablet, and phone.
- Do not turn this into a full accounting, payroll, tax-filing, or inventory system.
- Do not require an AI service for normal invoicing.
- Do not add subscriptions or payment processing in version one.
- Never claim a feature works unless it has been implemented and tested.

## TECHNICAL FOUNDATION

Use React, TypeScript, and a clean component-based architecture.

Use an owner-controlled Supabase project for:
- Authentication.
- PostgreSQL database.
- Private file storage.
- Server-side functions where necessary.

Before enabling a backend or connecting an external service, explain what is required and ask for approval. Do not silently choose a different backend.

Use database migrations stored with the project.
Prepare the project for GitHub synchronization and deployment outside the original builder.
Keep provider-specific integrations isolated so they can be replaced later.
Keep all secrets server-side.

Production invoice data must not depend on browser localStorage.
Browser storage may hold non-sensitive preferences only.
Real invoice records must persist in the database.

If a required service is not connected yet, show a truthful setup-required state. Never simulate successful saving, email delivery, or backups.

## AUTHENTICATION AND OWNERSHIP

Start with one owner account that can manage multiple businesses.
Use a workspace model that can support additional users later, without implementing complex team features now.

Every business belongs to a workspace.
Every customer, invoice, payment, template, and stored document belongs to a specific business.

Enforce access permissions in the database using row-level security.
Validate business ownership on server-side operations.
Do not rely on hiding UI controls for security.

Sign-out must clear sensitive application state.
Do not expose invoices or PDFs publicly by default.

## MAIN NAVIGATION

Provide these pages:
- Dashboard.
- Invoices.
- Customers.
- Products and services.
- Businesses.
- Templates and editor settings.
- Reports and exports.
- Backup and restore.
- Application settings.

Keep a prominent business switcher visible throughout the app.
Always show which business is active.
Provide a clearly labeled "All businesses" view for reporting only.

## 1. MULTIPLE BUSINESSES

Allow the owner to create and manage multiple business profiles without an artificial one-business limit.

Each business has:
- Display name.
- Legal business name, optional.
- Logo.
- Address.
- Phone.
- Email.
- Website.
- Optional tax or registration identification fields.
- Default currency.
- Default payment terms.
- Default invoice notes.
- Default payment instructions.
- Invoice numbering prefix and next number.
- Default tax and discount settings.
- Default invoice template.
- Default email subject and message.

Each business must have its own customers, items, templates, numbering, invoices, and reports.

Switching businesses must not accidentally reuse another business's:
- Logo or contact information.
- Customers.
- Tax settings.
- Payment instructions.
- Invoice sequence.
- Template.
- Unsaved invoice form contents.

If switching businesses with unsaved changes, offer:
Save draft, discard changes, or cancel.

Businesses with historical records should be archived rather than permanently deleted.

Allow different businesses to have customers with the same name.
Offer an explicit "Copy customer to another business" action, not silent sharing.

## 2. CUSTOMER MANAGEMENT

Create, edit, archive, search, and filter customers.

Customer fields:
- Individual or company name.
- Contact person.
- Billing address.
- Email.
- Phone.
- Optional shipping/service address.
- Customer notes.
- Default payment terms.
- Optional tax-exempt setting.

Show each customer's invoice history and outstanding balance.

Editing a customer's current details must not change details printed on previously issued invoices.

## 3. PRODUCTS AND SERVICES

Create a reusable item catalog for each business.

Fields:
- Item/service name.
- Description.
- Optional item code.
- Unit label, such as hours, each, visit, or project.
- Default rate.
- Default tax treatment.
- Active/archived status.

Allow one-time invoice line items without requiring a catalog entry.
Historical invoices must retain their original descriptions and prices when catalog items change.

## 4. INVOICE EDITOR

Provide:
- A simple form editor.
- A live invoice preview.
- Clearly visible save status.
- Easy keyboard navigation.

Invoice header fields:
- Business.
- Customer.
- Invoice number.
- Invoice date.
- Due date.
- Optional purchase order or reference number.
- Optional service date or service period.
- Currency.

Line-item fields:
- Description.
- Quantity.
- Unit.
- Unit price.
- Optional discount.
- Optional tax.
- Calculated line total.

Allow:
- Add, remove, duplicate, and reorder line items.
- Multi-line descriptions.
- Decimal quantities.
- Optional custom fields.
- Notes.
- Terms.
- Payment instructions.

Show:
- Subtotal.
- Discount.
- Tax, grouped by rate where appropriate.
- Optional additional charge.
- Invoice total.
- Payments received.
- Remaining balance.

Use precise decimal arithmetic or integer minor units with appropriate handling for fractional quantities.
Do not use ordinary floating-point arithmetic as the source of truth for monetary totals.

For version one:
- Default to USD.
- Support one currency per invoice.
- Define a consistent rounding policy.
- Support tax-exclusive pricing.
- Clearly label unsupported tax modes rather than approximating them.
- Allow either line discounts or an invoice discount, with explicit rules preventing accidental double-discounting.
- Explain calculation order in documentation and tests.
- Do not imply tax settings automatically satisfy any jurisdiction's requirements.

Validate required fields and invalid amounts.
Prevent accidental duplicate submissions.
Warn before leaving with unsaved changes.

Autosave drafts with a visible saved/saving/failed indicator.
Do not overwrite a newer version silently if the same invoice is edited in two tabs.

## 5. NUMBERING AND RECORD INTEGRITY

Assign the final invoice number when an invoice is issued, using an atomic database operation.

Each business has its own sequence.
Enforce uniqueness within that business.
Do not reuse issued numbers after voiding an invoice.
Do not promise gap-free numbering.

Drafts may use an internal draft identifier before issuance.

At issuance, save an immutable snapshot of:
- Business identity and contact information.
- Customer billing details.
- Invoice lines and calculations.
- Currency.
- Tax and discount settings.
- Notes and payment instructions.
- Template configuration.

Changing business details, customer details, catalog prices, or templates later must not alter an issued invoice.

Generate and privately store the issued PDF.
Reprinting or re-emailing an issued invoice should use the issued version, not silently regenerate it with today's settings.

Allow direct editing of drafts.
For issued invoices, use a clearly labeled correction/revision workflow:
- Preserve the original version.
- Record the reason and timestamp.
- Show the revision history.
- Never silently replace a document previously sent to a customer.

Do not present this revision workflow as universally compliant with every jurisdiction's invoicing rules.

## 6. INVOICE STATUS AND HISTORY

Keep document status, payment status, and email delivery status separate.

Document states:
- Draft.
- Issued.
- Void.

Payment states:
- Unpaid.
- Partially paid.
- Paid.

Calculate overdue status from due date, remaining balance, and document state.
Opening an invoice or downloading its PDF must not mark it paid or emailed.

Invoice history must support:
- Search by invoice number, customer, reference, and notes.
- Filter by business, date range, document status, payment status, and overdue status.
- Sort by date, number, customer, total, and balance.
- Pagination.
- Open, duplicate, download PDF, print, email, record payment, and void where appropriate.

Duplicating an invoice creates a new draft without copying its invoice number, payment history, or delivery history.

Record an audit trail for important events:
Creation, issuance, revision, email attempt, payment entry, payment reversal, and voiding.

Do not permanently delete issued invoices through ordinary UI actions.

## 7. PAYMENTS AND RECEIPTS

Support manual recording of:
- Cash.
- Check.
- Bank transfer.
- Other payment methods.

Fields:
- Payment date.
- Amount.
- Method.
- Reference.
- Optional note.

Support partial payments and multiple payments.
Reject payments exceeding the balance in version one with a clear explanation.
Use a reversal/correction record rather than silently erasing a payment.
Prevent accidental duplicate payment submissions.

Generate a payment receipt showing the payment and remaining balance.

No bank connection or card processing is required for version one.
Do not store card numbers or banking credentials.

## 8. PDF, PRINTING, AND SHARING

Provide a prominent output menu:
- Download PDF.
- Print.
- Email invoice.
- Download receipt when applicable.
- Export invoice data.

PDF requirements:
- Professionally formatted.
- Selectable text where practical.
- Clear business identity.
- All line items, totals, notes, and payment instructions.
- Supported logo image.
- Proper multi-page layout.
- No clipped columns or overlapping text.
- Repeat table headers on subsequent pages.
- Keep totals readable and together where possible.
- Support US Letter and A4.
- Safe, descriptive filenames.

Use one shared invoice rendering model so the preview, PDF, and printed output agree.

Draft PDFs must be clearly marked DRAFT.
Issued PDF generation failures must be visible and recoverable, without issuing a second invoice number.

Print requirements:
- Hide navigation, buttons, and editor controls.
- Use print-specific styles.
- Never print the application dashboard around the invoice.
- Provide a preview before printing.

PDF export must not require an email provider.

Email requirements:
- Use a replaceable server-side email provider integration.
- Store credentials only as server-side secrets.
- Support sending the actual issued PDF as an attachment.
- Allow recipient, optional CC/BCC, subject, and message editing.
- Display the sending business and attachment before confirmation.
- Require an explicit send action.
- Record success, failure, provider message ID, and available delivery events.
- Do not label a provider-accepted message as guaranteed delivered.
- Prevent duplicate sends from repeated clicks.
- Offer intentional resend with confirmation.
- Show useful retry behavior without silently sending duplicates.

Use a verified sending domain or authorized sender.
Business contact email may be used as Reply-To when appropriate.
Do not spoof arbitrary business From addresses.

If email integration is not configured:
- Explain that setup is required.
- Keep PDF download working.
- Offer "Copy email message."
- Explain that a mailto link cannot automatically attach the PDF.
- Provide instructions to manually attach the downloaded PDF.

Optional public links should remain out of scope for version one unless requested.
If added later, use revocable, hard-to-guess access tokens and disclose that anyone holding the link can access it.

## 9. CUSTOMIZABLE INVOICING SCREEN

Separate these three tasks:
A. Editing invoice content.
B. Customizing the invoice editor.
C. Customizing the printed/PDF template.

Invoice editor customization:
- Rename optional field labels.
- Show/hide optional fields.
- Reorder optional sections.
- Set default values.
- Create typed custom fields: text, date, number, and dropdown.
- Choose whether custom fields appear internally, on the PDF, or both.
- Save preferences per business.
- Reset to defaults.

Do not allow users to hide or remove critical identity, numbering, currency, or total information needed to understand the invoice.

## 10. TEMPLATE DESIGNER

Create three clean starting templates:
- Classic.
- Modern.
- Compact.

Allow each business to customize:
- Logo size and placement.
- Accent color.
- Font from a curated supported list.
- Header alignment.
- Address placement.
- Optional columns.
- Column labels.
- Notes and footer.
- Terms and payment instructions.
- Custom field visibility.
- Paper size.

Provide live preview, save as new template, duplicate, rename, and reset.

Use constrained controls rather than an unrestricted drag-and-drop canvas that could create broken PDFs.

Version template settings.
Issued invoices retain their original template version.
Changing a default template affects new invoices only.

## 11. DASHBOARD AND REPORTS

For the active business, show:
- Issued invoice total for the selected period.
- Payments recorded during the selected period.
- Outstanding balance.
- Overdue balance.
- Recent invoices.
- Quick actions.

Define each metric clearly.
Do not call invoiced amounts profit or recognized accounting revenue.
Exclude void invoices and drafts where appropriate.

Provide reports by:
- Date range.
- Customer.
- Invoice status.
- Payments.
- Outstanding balances.

All-business reporting must visibly identify each business.
Do not combine different currencies into a single total without conversion.
Version one may group totals by currency without implementing exchange rates.

## 12. EXPORT, BACKUP, AND RESTORE

Data portability is a core feature, not an afterthought.

Provide:
- CSV export of invoices, customers, line items, and payments.
- A documented, versioned JSON export preserving relationships.
- Bulk download of issued PDFs.
- A backup package including data, logos, and stored issued documents.
- Single-business and whole-workspace export options.

Exports must enforce the same access permissions as normal app use.
Protect CSV exports against spreadsheet formula injection.

Backup screen:
- Explain the difference between an export and an automated backup.
- Display only verified backup/export timestamps.
- Never show "backed up" merely because a user opened the page.
- Provide a downloadable backup package.
- Document any hosting-provider backup setup still required.

Restore workflow:
- Validate file format and schema version.
- Preview record counts and affected businesses.
- Detect duplicate records and invoice-number conflicts.
- Show a dry-run result.
- Require confirmation.
- Preserve relationships and original issued snapshots.
- Avoid partially importing a broken dataset.
- Report validation failures clearly.

Do not export passwords, provider secrets, or authentication tokens.

Document how to:
- Export source code.
- Back up the database and files.
- Restore the app.
- Redeploy it with a compatible backend and hosting provider.
- Replace the email provider.

Do not promise that the app will run forever without hosting, maintenance, or costs.

## 13. IMPORT FROM EXISTING SOFTWARE

Do not assume access to the old software or a proprietary import format.

Implement:
- Customer CSV import.
- Product/service CSV import.
- Historical invoice CSV import with documented required fields.
- Column mapping.
- Preview and validation.
- Duplicate detection.
- Business selection.
- Clear import error reporting.

Preserve original invoice numbers where valid.
Require a decision when numbers conflict.
Do not advance or overwrite sequences without explanation.

Support uploading historical PDFs as archived documents.
Do not pretend an uploaded PDF has been accurately converted to structured invoice data.
Mark imported historical records with their source and import date.

Provide sample import files and instructions.

## 14. SECURITY AND PRIVACY

Implement:
- Row-level security on all business data.
- Private document storage.
- Short-lived authenticated download URLs where needed.
- Server-side validation.
- Ownership checks for every privileged action.
- Safe handling of file uploads.
- Sanitization of rich/user-supplied content.
- Rate limiting for email operations.
- No secrets or customer information in public logs.
- No financial records in publicly accessible demo data.

Test access using two different owner accounts.
An account must not access another account's businesses, records, or files by guessing IDs.

Confirm potentially destructive actions.
Show the active business in those confirmations.

## 15. DESIGN AND ACCESSIBILITY

Use a calm, professional interface with:
- Neutral background.
- Clear typography.
- Strong contrast.
- Large primary actions.
- Consistent spacing.
- Plain-English labels.
- Helpful empty states.

Optimize the main workflow:
Select business → select customer → add items → preview → issue → download/print/email.

Desktop:
Side-by-side editor and preview.

Mobile:
Stacked editor and preview with accessible navigation.
Avoid requiring tiny table cells for editing.
Keep save/preview actions accessible without covering content.

Support keyboard navigation, visible focus states, labeled fields, and screen-reader-friendly errors.
Do not rely on color alone for statuses.

## 16. REQUIRED TESTS

Use automated tests where appropriate and document manual tests.

Test:
- Two businesses with different logos and identical invoice-number sequences.
- Business switching without leaking customer or form data.
- Independent numbering.
- Concurrent issuance without duplicate numbers.
- Decimal quantities and monetary rounding.
- Discounts and mixed taxable/non-taxable items.
- Partial payments and reversals.
- Overdue calculations.
- Customer edits not changing old invoices.
- Business edits not changing old invoices.
- Template edits not changing old invoices.
- Issued invoice revision history.
- Long descriptions and a 50-line invoice PDF.
- US Letter and A4 output.
- Print output with no app navigation.
- PDF generation failure and retry.
- Email success, failure, repeat-click prevention, and intentional resend.
- Missing email credentials with honest fallback.
- Search, filtering, and pagination.
- Refresh and sign-out/sign-in persistence.
- Two-tab editing conflicts.
- Unauthorized database and file access.
- Export and restore round trip.
- Malformed imports and duplicate invoice numbers.
- Phone, tablet, and desktop layouts.
- Empty states and network failure behavior.

Calculation test:
Line 1: 2 × $75.00 = $150.00.
Line 2: 1 × $50.00 = $50.00.
Subtotal: $200.00.
Invoice discount: 10% = $20.00.
Taxable amount: $180.00.
Tax: 6% = $10.80.
Invoice total: $190.80.
Payment: $100.00.
Remaining balance: $90.80.

Treat this as a software calculation test, not jurisdiction-specific tax advice.

## 17. DEVELOPMENT SEQUENCE

Implement in controlled phases within this project:

Phase 1:
Architecture, schema, authentication, permissions, businesses, customers, item catalog, and persistent draft editor.

Phase 2:
Invoice issuance, numbering, immutable snapshots, history, payments, and audit trail.

Phase 3:
Templates, PDF generation, printing, and receipts.

Phase 4:
Email integration with truthful setup states and delivery tracking.

Phase 5:
Imports, exports, backup/restore, reports, and portability documentation.

Phase 6:
Security tests, calculation tests, responsive testing, accessibility, and bug fixing.

Do not substitute a polished mockup for missing functionality.
Keep demo data separate and clearly labeled.
Do not seed fictional invoices into the production account.

Before starting:
- Present a concise implementation plan.
- List required services and setup decisions.
- Identify any external service costs or limits that must be checked.
- Ask only questions that materially block implementation.
- Use sensible defaults for optional visual choices.

At the end of every phase:
- State what is implemented.
- State what was actually tested.
- State what remains unconfigured.
- List known limitations.
- Fix critical failures before moving on.

## FINAL ACCEPTANCE CRITERIA

An owner can:
1. Sign in.
2. Create two distinct businesses.
3. Switch between them safely.
4. Create customers and invoices for each.
5. Customize the editor and invoice template.
6. Save a draft and reopen it later.
7. Issue an invoice with a unique business-specific number.
8. Download and print an accurate PDF.
9. Email the issued PDF after configuring email.
10. Record partial and full payments.
11. Find past invoices and retrieve their original documents.
12. Export all data and documents.
13. Restore a tested backup.
14. Access documented source-code and deployment procedures.

Deliver a working app, setup checklist, test results, known limitations, and an owner-friendly operating guide.
