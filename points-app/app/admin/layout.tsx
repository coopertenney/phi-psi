import type { ReactNode } from 'react';
import Link from 'next/link';
import { signOut } from './actions';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <main>
      <h1>Points &amp; Attendance</h1>
      <p className="sub">
        Exec view. <a className="link" href="/board" target="_blank" rel="noreferrer">Public leaderboard link ↗</a>
      </p>
      <nav className="tabs">
        <Link href="/admin">Log points</Link>
        <Link href="/admin/catalog">Catalog &amp; settings</Link>
        <Link href="/admin/attendance">Attendance</Link>
        <form action={signOut} style={{ marginLeft: 'auto' }}>
          <button type="submit" className="secondary">Sign out</button>
        </form>
      </nav>
      {children}
    </main>
  );
}
