import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

// Paths reachable while logged OUT. Everything else redirects to /login.
// /auth/confirm must be public: it's where an invite/reset token arrives to
// establish the session (no cookie yet at that point).
const PUBLIC_PATHS = ['/login', '/auth/confirm'];

// Does this request carry a Supabase auth cookie at all? The session cookie is
// `sb-<project-ref>-auth-token`, sometimes split into `.0`, `.1` chunks. This
// distinguishes a genuinely logged-out visitor (no cookie) from a logged-in
// member whose single getUser() call happened to hiccup (cookie present).
function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name));
}

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

  // getUser() validates the token with Supabase Auth AND refreshes the session,
  // writing the rotated cookies via setAll above. We distinguish three cases so
  // that a member is never logged out except when their session is genuinely
  // dead (the friction we're eliminating). RLS is the real security boundary
  // (no session → queries return nothing), so this redirect is only UX.
  //   • user returned            → signed in, proceed.
  //   • returned error, no user  → token expired/revoked (genuinely dead) →
  //                                fall through to a clean /login redirect.
  //   • getUser() THREW          → transient network/Auth hiccup → keep a
  //                                member who holds a valid cookie signed in.
  let user = null;
  let transient = false;
  try {
    ({ data: { user } } = await supabase.auth.getUser());
  } catch {
    transient = true;
  }

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'));
  const loggedIn = Boolean(user) || (transient && hasAuthCookie(request));

  // No session cookie at all, asking for a protected page → send to login.
  // (A member with a session but a momentarily failed refresh keeps their
  // session; the next request refreshes cleanly from the cookies set above.)
  if (!loggedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Confirmed logged in but sitting on /login → bounce to the dashboard.
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
  //
  // `sw.js` and `manifest.webmanifest` must also be public: the browser fetches
  // both before/regardless of a session (the service worker registers on the
  // login page too), and a 307→/login would break PWA install + Web Push.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2?)$).*)'],
};
