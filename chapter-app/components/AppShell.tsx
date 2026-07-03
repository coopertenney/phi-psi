'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { icons, type IconName } from './icons';
import { MemberAvatar } from './MemberAvatar';
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
  '/socials': 'Socials',
  '/attendance': 'Attendance',
  '/points': 'Points',
  '/announcements': 'Announcements',
  '/files': 'Files',
  '/profile': 'Profile',
  '/access': 'Access',
};

export function AppShell({ members, currentUser, children }: {
  members: MemberRow[];
  currentUser: { fullName: string; title: string; avatarUrl?: string | null } | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { persona, setPersona, isAdmin, canSwitchPersona, tabAccess } = useApp();
  // Mobile nav drawer. Closes on any route change so tapping a link dismisses it.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [pathname]);
  // These auth screens render on their own, without the sidebar/topbar chrome.
  // (Hooks above must run first — Rules of Hooks — so this return comes after.)
  if (pathname === '/login' || pathname === '/set-password') return <>{children}</>;
  const pageTitle = PAGE[pathname] ?? 'Cal Beta';
  // Show the real signed-in member; fall back to the demo user only in mock mode.
  const user = currentUser
    ? { name: currentUser.fullName, title: currentUser.title, avatarUrl: currentUser.avatarUrl ?? null }
    : { ...MOCK_USER[persona], avatarUrl: null as string | null };

  // Admins see every tab plus the Access screen; everyone else sees only the
  // tabs enabled for their audience.
  const aud = audienceFor(persona);
  const tabs = isAdmin
    ? [...NAV_TABS, { href: '/access', id: 'access', label: 'Access' }]
    // Default missing keys to visible (!== false), so a renamed/added tab (e.g.
    // /events → /socials) isn't hidden for anyone with older persisted tabAccess.
    : NAV_TABS.filter((t) => (aud ? tabAccess[aud][t.href] !== false : true));

  return (
    <div className={`pkp-app${navOpen ? ' nav-open' : ''}`}>
      {/* Tapping the dimmed backdrop closes the mobile drawer. Desktop hides it. */}
      <div className="pkp-nav-scrim" onClick={() => setNavOpen(false)} aria-hidden />

      <aside className="pkp-sidebar">
        <div className="pkp-brand">
          <img className="pkp-crest" src="/crest.png" alt="Phi Kappa Psi coat of arms" />
          <div>
            <div className="pkp-brand-name">Phi Kappa Psi</div>
            <div className="pkp-brand-sub">Cal Beta · Stanford</div>
            <div className="pkp-brand-est">Est. 1852</div>
          </div>
        </div>
        <div className="pkp-brand-rule" />
        <nav className="pkp-nav">
          {tabs.map((n) => {
            const active = pathname === n.href || (n.href === '/dashboard' && pathname === '/');
            return (
              <Link key={n.href} href={n.href} className={`pkp-nav-btn${active ? ' active' : ''}`} onClick={() => setNavOpen(false)}>
                <span className="ico">{icons[n.id as IconName]}</span>
                <span>{n.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Mobile only: the identity + persona + sign-out that live in the topbar
            on desktop move into the drawer, where there's room. */}
        <div className="pkp-drawer-account">
          <Link href="/profile" className="pkp-drawer-user" style={{ textDecoration: 'none', color: 'inherit' }} onClick={() => setNavOpen(false)}>
            <MemberAvatar name={user.name} src={user.avatarUrl} size={34} />
            <div style={{ lineHeight: 1.15, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--pkp-side-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--pkp-side-muted)' }}>{user.title}</div>
            </div>
          </Link>
          {canSwitchPersona && (
            <div className="pkp-seg" title="View as" style={{ marginTop: 10 }}>
              {PERSONAS.map((p) => (
                <button key={p.id} className={persona === p.id ? 'on' : ''} onClick={() => setPersona(p.id)}>{p.label}</button>
              ))}
            </div>
          )}
          <div style={{ marginTop: 10 }}><AuthButton /></div>
        </div>

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
          <button className="pkp-hamburger" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <div className="pkp-masthead">
            <span className="pkp-eyebrow">Cal Beta Chapter</span>
            <h1 className="pkp-title">{pageTitle}</h1>
          </div>
          <div className="pkp-topbar-actions">
            <SearchBox members={members} />
            {canSwitchPersona && (
              <div className="pkp-seg" title="View as">
                {PERSONAS.map((p) => (
                  <button key={p.id} className={persona === p.id ? 'on' : ''} onClick={() => setPersona(p.id)}>{p.label}</button>
                ))}
              </div>
            )}
            <Link href="/profile" title="Your profile" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: 'inherit' }}>
              <MemberAvatar name={user.name} src={user.avatarUrl} size={38} />
              <div style={{ lineHeight: 1.15 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-900)' }}>{user.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{user.title}</div>
              </div>
            </Link>
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
