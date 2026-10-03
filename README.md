# My Business Invoice Desk

Multi-business invoicing application — a clean, original rebuild of a legacy
invoicing workflow, with strict data-ownership and correctness guarantees.

**Businesses:** Kaleky Computer Consulting Inc · Dania Realty Inc
(each with its own header, logo, numbering, customers, catalog, and templates)

## Status

**Phase 1 complete** — architecture, Supabase schema + RLS, owner auth, businesses,
customers, item catalog, persistent draft editor, integer-cents money math.

Phases 2–6 (issuance + atomic numbering, templates + PDF, email, imports/exports/
reports, hardening) build on this foundation.

## Quick start

See [SETUP.md](SETUP.md) for the full checklist. Short version:

```bash
cd app
cp .env.example .env        # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev                 # http://localhost:5173
npm test                    # 19 money-math tests, incl. the $190.80 spec case
npm run build               # production build
```

Apply `supabase/migrations/0001_phase1.sql` in the Supabase SQL editor before
first run. Seed the 25-item catalog with `supabase/seeds/kaleky-catalog-items.sql`.

## Layout

- `app/` — React + TypeScript + Vite frontend
  - `src/lib/money.ts` — integer minor-unit arithmetic (no floats), half-up rounding
  - `src/data/` — Supabase repositories (businesses, customers, items, drafts)
  - `src/pages/` — Dashboard, Invoices, InvoiceEditor, Customers, Items, Businesses, Settings
- `supabase/migrations/` — versioned SQL schema with row-level security
- `supabase/seeds/` — catalog seed data
- `SPEC.md` — the full build specification (source of truth)
- `legacy-feature-map.md` — feature map transcribed from the legacy app's screens

## Non-negotiables (from SPEC.md)

- Production invoice data lives in Postgres (Supabase), never browser localStorage.
- One owner login; businesses are strictly isolated; RLS on every table.
- Money is integer cents; the documented calculation order is tested.
- Issued invoices are immutable snapshots; drafts are editable.
- The app never claims saving/email/backup works unless it is implemented and tested.
