'use client';

// Keeps every device in sync with the desktop. Server components read Supabase
// per request; after a write the *writing* client calls router.refresh(), but
// another open session (a phone sitting on a screen) would otherwise show stale
// data until it navigates. This does a soft data refresh — re-runs the server
// render, no full reload, client state (open modals, scroll) survives — whenever
// the tab regains focus/visibility, plus a slow while-visible poll so a session
// that's foregrounded the whole time (someone watching the app while an exec
// edits on a laptop) still catches changes it never got a focus event for.
//
// Distinct from VersionWatcher: that does a *hard reload* for a new build
// (updates the PWA shell); this does a *soft refresh* for data on the current
// build. Both mounted in the root layout.
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const POLL_MS = 60 * 1000; // catch-up for a session that never loses focus

export function DataRefresher() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Auth screens carry no chapter data, and refreshing mid-login is needless
    // churn — the login/set-password flows handle their own router.refresh().
    if (pathname === '/login' || pathname === '/set-password') return;

    // Only refresh a visible tab: no point re-fetching for a backgrounded PWA,
    // and the visibilitychange handler covers the moment it comes back.
    const refresh = () => { if (document.visibilityState === 'visible') router.refresh(); };

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const id = setInterval(refresh, POLL_MS);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      clearInterval(id);
    };
  }, [pathname, router]);

  return null;
}
