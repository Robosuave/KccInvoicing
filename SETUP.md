# Setup Guide — My Business Invoice Desk (Phase 1)

Phase 1 is built and tested. To run it with a real database, complete the steps below.
Until then, the app shows an honest "Backend setup required" state — it will not
pretend to save anything.

## 1. Create the Supabase project

1. Go to https://supabase.com and create a free account.
2. Create a new project (any name, e.g. `invoice-desk`). Save the database password.
3. Wait for the project to finish provisioning.

## 2. Apply the database schema

1. In the Supabase dashboard, open the **SQL Editor**.
2. Open `supabase/migrations/0001_phase1.sql` from this repo, paste it in, and run it.
3. Verify: Table Editor should show `workspaces`, `workspace_members`, `businesses`,
   `customers`, `items`, `invoices`, `invoice_lines` — and Storage should show a
   private `business-logos` bucket.

## 3. Configure the app

1. In Supabase: **Project Settings → API**. Copy the **Project URL** and the **anon public key**.
   (Never use the service-role key in the app.)
2. In `app/`, copy `.env.example` to `.env` and fill in:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Install and run:
   ```bash
   cd app
   npm install
   npm run dev
   ```

## 4. Create the owner account

1. Open the app, choose **Create the owner account**, and sign up.
2. The first sign-in automatically creates your workspace.
3. Add your businesses (e.g. Kaleky Computer Consulting Inc, then Dania Realty Inc).

## 5. Seed the item catalog (optional)

After creating the Kaleky Computer Consulting business:

1. In the app, go to **Businesses** and copy the business ID from the URL or database.
   (Simplest: Table Editor → `businesses` → copy the `id`.)
2. Open `supabase/seeds/kaleky-catalog-items.sql`, replace every `YOUR_BUSINESS_ID`
   with that ID, and run it in the SQL Editor.
3. This inserts the 25 transcribed catalog items (keeps the two "Cat 3 Telephone"
   entries separate; "Elite Pos" uses the `month` unit label).

## 6. What is NOT set up yet (later phases)

- **Invoice issuance / numbering / PDF / email** — Phase 2–4.
- **GitHub sync** — Phase 5: `git init`, push to a private repo you own.
- **Production hosting** — Phase 5/6: Vercel/Netlify or similar; set the same two
  env vars in the host's dashboard.

## Troubleshooting

- "Backend setup required" still shows → `.env` is missing or the dev server was
  started before `.env` was created. Restart `npm run dev`.
- RLS errors on save → the SQL migration was not fully applied, or you are signed
  in with a different user than the workspace owner.
- Logo upload fails → check the `business-logos` bucket exists and is private.
