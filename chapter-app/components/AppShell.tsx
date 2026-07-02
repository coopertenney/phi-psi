'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { icons, type IconName } from './icons';
import { Avatar } from './ui';
import { SearchBox } from './SearchBox';
import { AuthButton } from './AuthButton';
import { useApp } from './Providers';
import { MOCK_USER } from '@/lib/session';
import { NAV_TABS, PERSONAS, audienceFor } from '@/lib/nav';
import { CURRENT_QUARTER_LABEL, CURRENT_ACADEMIC_YEAR } from '@/lib/calendar';
import type { MemberRow } from '@/lib/types';

const PAGE: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/members': 'Members',
  '/recruitment': 'Recruitment',
  '/finances': 'Finances',
  '/events': 'Events',
  '/attendance': 'Attendance',
  '/points': 'Points',
  '/announcements': 'Announcements',
  '/files': 'Files',
  '/access': 'Access',
};

export function AppShell({ members, currentUser, children }: {
  members: MemberRow[];
  currentUser: { fullName: string; title: string } | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { persona, setPersona, isAdmin, tabAccess } = useApp();
  // These auth screens render on their own, without the sidebar/topbar chrome.
  // (Hooks above must run first — Rules of Hooks — so this return comes after.)
  if (pathname === '/login' || pathname === '/set-password') return <>{children}</>;
  const pageTitle = PAGE[pathname] ?? 'Cal Beta';
  // Show the real signed-in member; fall back to the demo user only in mock mode.
  const user = currentUser
    ? { name: currentUser.fullName, title: currentUser.title }
    : MOCK_USER[persona];

  // Admins see every tab plus the Access screen; everyone else sees only the
  // tabs enabled for their audience.
  const aud = audienceFor(persona);
  const tabs = isAdmin
    ? [...NAV_TABS, { href: '/access', id: 'access', label: 'Access' }]
    : NAV_TABS.filter((t) => (aud ? tabAccess[aud][t.href] : true));

  return (
    <div className="pkp-app">
      <aside className="pkp-sidebar">
        <div className="pkp-brand">
          <img className="pkp-crest" src="/crest.png" alt="Phi Kappa Psi coat of arms" />
          <div>
            <div className="pkp-brand-name">Phi Kappa Psi</div>
            <div className="pkp-brand-sub">Cal Beta · Stanford</div>
          </div>
        </div>
        <nav className="pkp-nav">
          {tabs.map((n) => {
            const active = pathname === n.href || (n.href === '/dashboard' && pathname === '/');
            return (
              <Link key={n.href} href={n.href} className={`pkp-nav-btn${active ? ' active' : ''}`}>
                <span className="ico">{icons[n.id as IconName]}</span>
                <span>{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="pkp-side-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success-500)' }} />
            <span style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--pkp-side-fg)' }}>{CURRENT_QUARTER_LABEL}</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--pkp-side-muted)', marginTop: 4, paddingLeft: 15 }}>{CURRENT_ACADEMIC_YEAR} academic year</div>
        </div>
      </aside>

      <div className="pkp-main-col">
        <header className="pkp-topbar">
          <h1 className="pkp-title">{pageTitle}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <SearchBox members={members} />
            <div className="pkp-seg" title="View as">
              {PERSONAS.map((p) => (
                <button key={p.id} className={persona === p.id ? 'on' : ''} onClick={() => setPersona(p.id)}>{p.label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Avatar name={user.name} size={38} />
              <div style={{ lineHeight: 1.15 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-900)' }}>{user.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{user.title}</div>
              </div>
            </div>
            <AuthButton />
          </div>
        </header>

        <main className="pkp-main">
          <div className="pkp-main-inner">{children}</div>
        </main>
      </div>
    </div>
  );
}
