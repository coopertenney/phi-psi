// Service-role Supabase client — SERVER-ONLY, never import from a client
// component or expose the key to the browser. Bypasses RLS entirely, which is
// exactly what the Stripe webhook needs: it has no logged-in user/session to
// run RLS as, but it's the only thing allowed to write a `payments` row.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const isAdminSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

let cached: SupabaseClient | null = null;

export function getAdminSupabase(): SupabaseClient {
  if (!cached) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');
    cached = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  }
  return cached;
}
