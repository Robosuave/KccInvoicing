/**
 * App-wide configuration. The working name lives here so it is easy to change.
 */

export const APP_NAME = 'My Business Invoice Desk';

/**
 * Canonical public URL of the deployed app. Password-reset emails link here —
 * it is intentionally NOT derived from window.location.origin, because the
 * reset request can originate from a preview build or local dev server while
 * the emailed link must always open the live app.
 */
export const APP_URL = 'https://invoice.kalekycomputer.com';

export const DEFAULT_CURRENCY = 'USD';

/** Rounding policy: half-up, applied in integer minor units. See lib/money.ts. */
export const ROUNDING_POLICY = 'Half-up rounding on integer minor units (cents).';

/**
 * Supabase connection. These are read from the environment and are NOT secrets —
 * the anon key is safe to expose; row-level security enforces access.
 * The service-role key must NEVER appear here.
 */
export function supabaseConfig(): { url: string; anonKey: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isBackendConfigured(): boolean {
  return supabaseConfig() !== null;
}
