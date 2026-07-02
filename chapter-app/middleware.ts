import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

// Paths reachable while logged OUT. Everything else redirects to /login.
// /auth/confirm must be public: it's where an invite/reset token arrives to
// establish the session (no cookie yet at that point).
const PUBLIC_PATHS = ['/login', '/auth/confirm'];

export async function middleware(request: NextRequest) {
  // Mock mode (no env vars): no auth, no gate — the app runs on seed data.
  if (!isSupabaseConfigured) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options));
        },
      },
    },
  );

  // IMPORTANT: getUser() validates the token with Supabase Auth. getSession()
  // only trusts the cookie, so never gate on it. This call also refreshes the
  // session and writes the new cookies via setAll above.
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'));

  // Not logged in, asking for a protected page → send to login.
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Already logged in but sitting on /login → bounce to the dashboard.
  if (user && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Run on everything except Next internals, static asset files, and API routes.
  // API routes self-authenticate: the Stripe webhook (/api/stripe/webhook) has
  // no user session and verifies Stripe's signature instead, and the checkout
  // route does its own getUser() check (returning a JSON 401, not an HTML
  // redirect). Gating them here would 307-redirect Stripe's webhook to /login.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2?)$).*)'],
};
