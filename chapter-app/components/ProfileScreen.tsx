'use client';

import { useMemo } from 'react';
import type { MemberRow } from '@/lib/types';
import { money, duesBadge, statusBadge } from '@/lib/format';
import { currentMember } from '@/lib/session';
import { useApp } from './Providers';
import { Badge, MiniStat } from './ui';
import { AvatarUpload } from './AvatarUpload';

type Props = { members: MemberRow[]; myMembershipId: string | null; live?: boolean };

// The signed-in member's own profile — identity, photo (editable), standing,
// contact, and lineage. Resolves "me" the same way the other member views do:
// by membership id when live, by demo persona in mock mode.
export function ProfileScreen({ members, myMembershipId, live = false }: Props) {
  const { persona } = useApp();
  const me = live
    ? members.find((m) => m.membershipId === myMembershipId) ?? null
    : currentMember(members, persona) ?? null;

  const rank = useMemo(() => {
    if (!me) return null;
    return [...members].sort((a, b) => b.points - a.points).findIndex((m) => m.membershipId === me.membershipId) + 1;
  }, [members, me]);

  if (!me) {
    return <p style={{ color: 'var(--ink-500)' }}>Your member profile isn’t loaded yet.</p>;
  }

  const sb = statusBadge(me.status);
  const db = duesBadge(me.duesState);
  const settled = me.balanceCents <= 0;

  const detailRow = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '10px 0', borderTop: '1px solid var(--cream-200)' }}>
      <span style={{ fontSize: 13, color: 'var(--ink-500)' }}>{label}</span>
      <span style={{ fontSize: 13.5, color: 'var(--ink-800)', fontWeight: 500, textAlign: 'right', minWidth: 0 }}>{value}</span>
    </div>
  );

  return (
    <div style={{ maxWidth: 920, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Hero */}
      <div className="pkp-card pkp-card--feature" style={{ padding: 28, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
        <AvatarUpload name={me.fullName} src={me.avatarUrl} size={104} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="pkp-eyebrow-sm">Cal Beta · Stanford</div>
          <h1 style={{ margin: '5px 0 0', fontFamily: 'var(--font-serif)', fontSize: 30, fontWeight: 600, letterSpacing: '-.02em', color: 'var(--ink-900)', lineHeight: 1.05 }}>{me.fullName}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
            <span style={{ fontSize: 14, color: 'var(--ink-600)' }}>
              {me.roleLabel}{me.classYear ? ` · Class of ${me.classYear}` : ''}{me.committee ? ` · ${me.committee}` : ''}
            </span>
            <Badge tone={sb.tone}>{sb.label}</Badge>
          </div>
        </div>
      </div>

      {/* Standing */}
      <div className="pkp-card" style={{ padding: '18px 24px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <div className="pkp-stat">
          <div className="pkp-stat-val" style={{ color: 'var(--pkp-accent)' }}>{me.points}</div>
          <div className="pkp-stat-label">Points</div>
          <div className="pkp-stat-sub">{rank ? `#${rank} in chapter` : ''}</div>
        </div>
        <div className="pkp-stat">
          <div className="pkp-stat-val">{me.attendancePct}%</div>
          <div className="pkp-stat-label">Attendance</div>
          <div className="pkp-stat-sub">this term</div>
        </div>
        <div className="pkp-stat">
          <div className="pkp-stat-val" style={{ color: settled ? 'var(--success-600)' : 'var(--pkp-primary)' }}>{settled ? '$0' : money(me.balanceCents)}</div>
          <div className="pkp-stat-label">Dues balance</div>
          <div className="pkp-stat-sub">{db.label}</div>
        </div>
      </div>

      {/* Contact + Lineage */}
      <div className="pkp-grid-main" style={{ gap: 16, alignItems: 'start' }}>
        <div className="pkp-card" style={{ padding: 22 }}>
          <h3 className="pkp-h3" style={{ marginBottom: 6 }}>Contact</h3>
          {detailRow('Email', <a href={`mailto:${me.email}`} style={{ color: 'var(--pkp-primary-strong)', textDecoration: 'none' }}>{me.email || '—'}</a>)}
          {detailRow('Phone', me.phone || '—')}
          {detailRow('Committee', me.committee || 'Unassigned')}
        </div>
        <div className="pkp-card" style={{ padding: 22 }}>
          <h3 className="pkp-h3" style={{ marginBottom: 6 }}>Lineage</h3>
          {detailRow('Big', me.bigName ?? '—')}
          {detailRow('Littles', me.littleNames.length ? me.littleNames.join(', ') : '—')}
        </div>
      </div>

      {/* Flags */}
      {me.flags.length > 0 && (
        <div className="pkp-card" style={{ padding: 22 }}>
          <h3 className="pkp-h3" style={{ marginBottom: 12 }}>Needs attention</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {me.flags.map((f) => (
              <MiniStat key={f.id} val={<span style={{ fontSize: 14 }}>{f.label}</span>} label={f.note ?? f.severity} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
