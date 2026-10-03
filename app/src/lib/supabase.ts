import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig } from './config';

let client: SupabaseClient | null = null;

/**
 * Returns the Supabase client, or null when the backend is not configured.
 * Callers must handle null with a truthful setup-required state —
 * never simulate saving, email, or backups.
 */
export function getSupabase(): SupabaseClient | null {
  const cfg = supabaseConfig();
  if (!cfg) return null;
  if (!client) {
    client = createClient(cfg.url, cfg.anonKey);
  }
  return client;
}

/** Thrown/caught as a signal — never shown as a crash. */
export class BackendNotConfiguredError extends Error {
  constructor() {
    super('Backend not configured. Connect a Supabase project to save data.');
    this.name = 'BackendNotConfiguredError';
  }
}

/** Returns the client or throws BackendNotConfiguredError. */
export function requireSupabase(): SupabaseClient {
  const c = getSupabase();
  if (!c) throw new BackendNotConfiguredError();
  return c;
}

/** Clears the cached client (used on sign-out). */
export function resetSupabaseClient(): void {
  client = null;
}
