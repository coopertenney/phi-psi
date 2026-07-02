import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';
import { AppShell } from '@/components/AppShell';
import { getMembers, getCurrentUser } from '@/lib/data';

export const metadata: Metadata = {
  title: 'Phi Kappa Psi · Cal Beta',
  description: 'Chapter management dashboard',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Roster for the topbar search, fetched server-side so the live query runs
  // with the user's session (RLS). Empty on the logged-out /login render.
  const [members, currentUser] = await Promise.all([
    getMembers().catch(() => []),
    getCurrentUser().catch(() => null),
  ]);
  return (
    <html lang="en" data-theme="cardinal">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Spline+Sans+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          <AppShell members={members} currentUser={currentUser}>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
