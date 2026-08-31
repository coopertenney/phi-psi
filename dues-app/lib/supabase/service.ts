import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// The service-role client. It bypasses RLS entirely, so it is the only thing
// that can reach `sync_state` — the table holding the Plaid access token, which
// has RLS enabled and deliberately zero policies.
//
// Import this from as few places as possible: lib/bank/token-store.ts, the feed
// writer, and the cron/webhook routes. Never from a page, a component, or a
// server action that returns data to the browser. `server-only` makes a
// client-component import a build error rather than a leak.

let client: SupabaseClient | null = null;

export function getServiceSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'The bank sync needs SUPABASE_SERVICE_ROLE_KEY. Without it the app runs on the '
      + 'in-memory store and no bank connection is possible.',
    );
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
