import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Cal Beta Dues Desk',
  description: 'Dues ledger and payment review queue for Phi Kappa Psi Cal Beta.',
};

// Every route is dynamic. Without this, Next 14's fetch Data Cache serves stale
// Supabase reads on the deployed build — the bug that bit the chapter app.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
