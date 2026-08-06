import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'Points & Attendance' };
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
