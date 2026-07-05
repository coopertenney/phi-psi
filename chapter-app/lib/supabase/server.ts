import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cache } from 'react';

// True once both env vars are present. Until then the app uses mock data.
export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

// A *per-request* server client. It reads the auth session from the request
// cookies, so server-component queries run AS THE LOGGED-IN USER — which is what
// makes Row-Level Security (auth.uid()) work. Never cache this across requests:
// a singleton would freeze one user's session and leak it to everyone else.
//
// `cache()` (from React) memoizes for the lifetime of a SINGLE server request
// only — the layout and page in one navigation share one client instead of
// each minting their own. It is torn down when the request ends, so the
// "never across requests" rule above still holds.
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
});

// The signed-in auth user, deduped for the request. `auth.getUser()` is a real
// HTTP round-trip to Supabase Auth (it validates the JWT server-side), so
// several callers in one render — the layout's getCurrentUser + getMyMembershipId,
// plus each page's own membership resolution — would otherwise each pay for it.
// `cache()` collapses them to a single call per request. (The middleware runs in
// a separate runtime and keeps its own getUser — that one also refreshes the
// token, which is why it isn't shared here.)
export const getSessionUser = cache(async () => {
  const { data: { user } } = await getServerSupabase().auth.getUser();
  return user;
});
