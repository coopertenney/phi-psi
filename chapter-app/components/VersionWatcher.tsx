'use client';

// Makes the installed PWA notice when a newer build has been deployed. The build
// id baked into this bundle (NEXT_PUBLIC_BUILD_ID) is compared against the live
// deploy's id from /api/version. On a mismatch we show a small toast that reloads
// the page — an installed PWA otherwise keeps serving whatever build its shell
// was last loaded with until it's fully relaunched. No-op in local dev (id 'dev').
import { useEffect, useState } from 'react';

const CURRENT = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';
const CHECK_MS = 5 * 60 * 1000; // re-check every 5 min while open, plus on refocus

export function VersionWatcher() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (CURRENT === 'dev' || stale) return; // nothing to watch for locally / once flagged
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build?: string };
        if (!cancelled && build && build !== CURRENT) setStale(true);
      } catch {
        /* offline or transient — try again next tick */
      }
    };

    check();
    const id = setInterval(check, CHECK_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [stale]);

  if (!stale) return null;

  return (
    <button type="button" className="pkp-update-toast" onClick={() => window.location.reload()}>
      <span className="pkp-update-dot" aria-hidden />
      New version available — tap to refresh
    </button>
  );
}
