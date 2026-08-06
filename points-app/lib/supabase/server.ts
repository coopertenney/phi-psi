import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cache } from 'react';

// A per-request server client — reads the auth session from request cookies so
// RLS (auth.role() = 'authenticated') sees the signed-in exec. cache() scopes
// the memoization to one request; never hoist this to a module-level singleton.
export const getServerSupabase = cache(function getServerSupabase() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            /* called from a Server Component render — token refresh happens in middleware instead */
          }
        },
      },
    },
  );
});
