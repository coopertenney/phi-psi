import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';
import { AppShell } from '@/components/AppShell';
import { VersionWatcher } from '@/components/VersionWatcher';
import { DataRefresher } from '@/components/DataRefresher';
import { getMembers, getCurrentUser, getMyMembershipId } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Phi Kappa Psi · Cal Beta',
  description: 'Chapter management dashboard',
  // Home-screen install: the manifest link is injected automatically from
  // app/manifest.ts; these add the iOS apple-touch-icon + standalone web-app
  // hints so an installed icon and title look right on an iPhone.
  applicationName: 'PKP',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'PKP' },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#9E1B32', // cardinal-500 — colors the mobile status bar
};

// Chapter data changes constantly (points, dues, events, attendance) and every
// device should show the latest. Force dynamic rendering AND opt every Supabase
// read out of Next's fetch Data Cache: without force-no-store, a soft
// router.refresh() (see DataRefresher) can re-render and still hand back a
// cached, stale read in production — the exact staleness bug we hit before.
// Applies app-wide as a root-segment config. cache() in lib/supabase still
// dedups reads within a single request, so this doesn't double-fetch.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Roster for the topbar search, fetched server-side so the live query runs
  // with the user's session (RLS). Empty on the logged-out /login render.
  const [members, currentUser, myMembershipId] = await Promise.all([
    getMembers().catch(() => []),
    getCurrentUser().catch(() => null),
    getMyMembershipId().catch(() => null),
  ]);
  // Derive the sidebar persona from the signed-in user's role so a real member
  // sees member tabs — not whatever's cached in localStorage. Null in mock/demo
  // mode, where the topbar "view as" switcher drives the persona instead. A
  // signed-in user with no roster membership falls to least privilege (member).
  // Regular members with `status = 'new'` map to the new-member persona, which
  // is gated out of Recruitment (see defaultTabAccess in lib/nav).
  const signedInPersona = currentUser
    ? currentUser.accessRole === 'admin'
      ? 'admin'
      : currentUser.accessRole === 'exec'
        ? 'exec'
        : currentUser.status === 'new'
          ? 'new'
          : 'member'
    : null;
  return (
    <html lang="en" data-theme="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=Hanken+Grotesk:wght@400;500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&family=Spline+Sans+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers signedInPersona={signedInPersona}>
          <AppShell members={members} currentUser={currentUser} myMembershipId={myMembershipId} live={isSupabaseConfigured}>{children}</AppShell>
          <VersionWatcher />
          <DataRefresher />
        </Providers>
      </body>
    </html>
  );
}
