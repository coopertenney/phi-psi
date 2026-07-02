import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// True once both env vars are present. Until then the app uses mock data.
export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

// A *per-request* server client. It reads the auth session from the request
// cookies, so server-component queries run AS THE LOGGED-IN USER — which is what
// makes Row-Level Security (auth.uid()) work. Never cache this across requests:
// a singleton would freeze one user's session and leak it to everyone else.
export function getServerSupabase() {
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
          // In a Server Component you can't set cookies during render — Next
          // throws. Swallow it: token refresh is handled in middleware.ts, which
          // CAN write cookies. This block only matters there.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options));
          } catch {
            /* called from a Server Component render — safe to ignore */
          }
        },
      },
    },
  );
}
