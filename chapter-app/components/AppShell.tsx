'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { icons, type IconName } from './icons';
import { MemberAvatar } from './MemberAvatar';
import { SearchBox } from './SearchBox';
import { AuthButton } from './AuthButton';
import { ProfileDialog } from './ProfileDialog';
import { Modal, ModalActions } from './form';
import { useApp } from './Providers';
import { useEscapeKey } from './useEscapeKey';
import { MOCK_USER } from '@/lib/session';
import { NAV_TABS, PERSONAS, audienceFor } from '@/lib/nav';
import type { MemberRow } from '@/lib/types';

const PAGE: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/members': 'Members',
  '/lineage': 'Lineage',
  '/recruitment': 'Recruitment',
  '/finances': 'Finances',
  '/socials': 'Socials',
  '/points': 'Points & Attendance',
  '/announcements': 'Announcements',
  '/files': 'Files',
  '/access': 'Access',
};

export function AppShell({ members, currentUser, myMembershipId = null, live = false, children }: {
  members: MemberRow[];
  currentUser: { fullName: string; title: string; avatarUrl?: string | null } | null;
  myMembershipId?: string | null;
  live?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { persona, setPersona, isAdmin, canSwitchPersona, tabAccess, termLabel, academicYearLabel, nextTermLabel, cycleQuarter } = useApp();
  // Mobile nav drawer. Closes on any route change so tapping a link dismisses it.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [pathname]);
  useEscapeKey(() => setNavOpen(false), navOpen);
  // Profile now opens as a popup (no nav tab) from the avatar in the topbar/drawer.
  const [profileOpen, setProfileOpen] = useState(false);
  useEffect(() => setProfileOpen(false), [pathname]);
  // "Next quarter" is a one-way, chapter-wide marker change — guard it behind a
  // confirm so it can't be advanced by an accidental click.
  const [confirmQuarter, setConfirmQuarter] = useState(false);
  useEffect(() => setConfirmQuarter(false), [pathname]);
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
            const external = 'external' in n && n.external;
            const active = !external && (pathname === n.href || (n.href === '/dashboard' && pathname === '/'));
            const content = (
              <>
                <span className="ico">{icons[n.id as IconName]}</span>
                <span>{n.label}</span>
              </>
            );
            return external ? (
              <a key={n.href} href={n.href} target="_blank" rel="noopener noreferrer" className="pkp-nav-btn" onClick={() => setNavOpen(false)}>
                {content}
              </a>
            ) : (
              <Link key={n.href} href={n.href} className={`pkp-nav-btn${active ? ' active' : ''}`} onClick={() => setNavOpen(false)}>
                {content}
              </Link>
            );
          })}
        </nav>

        {/* Mobile only: the identity + persona + sign-out that live in the topbar
            on desktop move into the drawer, where there's room. */}
        <div className="pkp-drawer-account">
          <button
            type="button"
            className="pkp-drawer-user"
            style={{ textDecoration: 'none', color: 'inherit', background: 'none', border: 'none', padding: 0, width: '100%', cursor: 'pointer', textAlign: 'left' }}
            onClick={() => { setNavOpen(false); setProfileOpen(true); }}
          >
            <MemberAvatar name={user.name} src={user.avatarUrl} size={34} />
            <div style={{ lineHeight: 1.15, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--pkp-side-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--pkp-side-muted)' }}>{user.title}</div>
            </div>
          </button>
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
            <span style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--pkp-side-fg)' }}>{termLabel}</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--pkp-side-muted)', marginTop: 4, paddingLeft: 15 }}>{academicYearLabel} academic year</div>
          {/* Admin (President) can advance the chapter's current-term marker. */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setConfirmQuarter(true)}
              title={`Advance to ${nextTermLabel}`}
              style={{
                marginTop: 10, marginLeft: 15, display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'transparent', border: '1px solid var(--pkp-side-border)', borderRadius: 'var(--radius-pill)',
                color: 'var(--pkp-side-fg)', fontSize: 11.5, fontWeight: 600, padding: '5px 11px', cursor: 'pointer',
              }}
            >
              Next quarter <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>→</span>
            </button>
          )}
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
            <button type="button" title="Profile & settings" className="pkp-account-btn" style={{ textDecoration: 'none', color: 'inherit', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setProfileOpen(true)}>
              <MemberAvatar name={user.name} src={user.avatarUrl} size={38} />
              <div style={{ lineHeight: 1.15 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-900)' }}>{user.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{user.title}</div>
              </div>
            </button>
            <AuthButton />
          </div>
        </header>

        <main className="pkp-main">
          <div className="pkp-main-inner">{children}</div>
        </main>
      </div>

      {profileOpen && (
        <ProfileDialog
          members={members}
          myMembershipId={myMembershipId}
          live={live}
          onClose={() => setProfileOpen(false)}
        />
      )}

      {confirmQuarter && (
        <Modal
          title="Advance the chapter term?"
          sub={`${termLabel} → ${nextTermLabel}`}
          width={440}
          onClose={() => setConfirmQuarter(false)}
          footer={
            <ModalActions
              onCancel={() => setConfirmQuarter(false)}
              onSave={() => { cycleQuarter(); setConfirmQuarter(false); }}
              saveLabel={`Advance to ${nextTermLabel}`}
            />
          }
        >
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-700)' }}>
            You&rsquo;re about to advance the chapter&rsquo;s current-term marker from{' '}
            <strong style={{ color: 'var(--ink-900)' }}>{termLabel}</strong> to{' '}
            <strong style={{ color: 'var(--ink-900)' }}>{nextTermLabel}</strong>. Here&rsquo;s
            exactly what that does:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--success-500)' }}>
              What will change
            </div>
            {[
              <>The term shown in the sidebar becomes <strong style={{ color: 'var(--ink-800)' }}>{nextTermLabel}</strong>.</>,
              <>The term label on the Dashboard and Finances dues cards updates to match.</>,
              <>Every member sees the new term &mdash; this is chapter-wide, not just your view.</>,
              <>The change saves immediately and persists across reloads.</>,
            ].map((line, i) => (
              <div key={i} style={{ display: 'flex', gap: 9, fontSize: 13, lineHeight: 1.5, color: 'var(--ink-700)' }}>
                <span aria-hidden style={{ color: 'var(--success-500)', flexShrink: 0, fontWeight: 700 }}>✓</span>
                <span>{line}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-400)' }}>
              What stays the same
            </div>
            {[
              <>No points, dues charges, payments, or attendance records are touched.</>,
              <>Nothing is recalculated, reset, or moved to the new term.</>,
            ].map((line, i) => (
              <div key={i} style={{ display: 'flex', gap: 9, fontSize: 13, lineHeight: 1.5, color: 'var(--ink-500)' }}>
                <span aria-hidden style={{ color: 'var(--ink-400)', flexShrink: 0, fontWeight: 700 }}>&ndash;</span>
                <span>{line}</span>
              </div>
            ))}
          </div>

          <div style={{
            display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.5,
            background: 'var(--danger-100)', color: 'var(--danger-600)', padding: '11px 13px',
            borderRadius: 'var(--radius-md)', border: '1px solid var(--danger-500)',
            boxShadow: '0 0 0 3px rgba(189,79,63,.14)',
          }}>
            <span aria-hidden style={{ flexShrink: 0, fontSize: 15, lineHeight: 1.3 }}>⚠</span>
            <span>
              <strong style={{ fontWeight: 700 }}>This can&rsquo;t be undone.</strong> There&rsquo;s
              no &ldquo;previous quarter&rdquo; button &mdash; you can only move forward. Double-check
              the term above before confirming.
            </span>
          </div>
        </Modal>
      )}
    </div>
  );
}
