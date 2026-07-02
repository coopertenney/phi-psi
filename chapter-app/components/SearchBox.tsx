'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MemberRow } from '@/lib/types';
import { Avatar } from './ui';
import { icons } from './icons';

// Real chapter search: filters the roster and jumps to the member (the Members
// screen reads the requested focus from sessionStorage and opens their drawer).
// The roster is fetched server-side (RLS-correct) in the root layout and passed
// down — a client component can't run the server data layer directly.
export function SearchBox({ members }: { members: MemberRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, []);

  const needle = q.trim().toLowerCase();
  const results = needle
    ? members.filter((m) =>
        m.fullName.toLowerCase().includes(needle) ||
        m.roleLabel.toLowerCase().includes(needle) ||
        (m.committee ?? '').toLowerCase().includes(needle),
      ).slice(0, 6)
    : [];

  const go = (m: MemberRow) => {
    sessionStorage.setItem('pkp-focus-member', m.membershipId);
    setQ('');
    setOpen(false);
    router.push('/members');
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div className="pkp-search">
        <span style={{ display: 'inline-flex' }}>{icons.search}</span>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) go(results[0]); if (e.key === 'Escape') setOpen(false); }}
          placeholder="Search chapter…"
          style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13.5, color: 'var(--ink-800)', width: '100%', fontFamily: 'var(--font-sans)' }}
        />
      </div>
      {open && needle && (
        <div className="pkp-card" style={{ position: 'absolute', top: 44, left: 0, right: 0, padding: results.length ? 6 : '12px 14px', zIndex: 30, boxShadow: 'var(--shadow-lg)' }}>
          {results.length === 0 ? (
            <span style={{ fontSize: 13, color: 'var(--ink-500)' }}>No matches.</span>
          ) : results.map((m) => (
            <button key={m.membershipId} onClick={() => go(m)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 'var(--radius-sm)', textAlign: 'left' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cream-100)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
              <Avatar name={m.fullName} size={28} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>{m.fullName}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{m.roleLabel} · {m.committee}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
