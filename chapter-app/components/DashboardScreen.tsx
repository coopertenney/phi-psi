'use client';

import { useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import type {
  MemberRow, ChapterStats, EventRow, AnnouncementRow,
} from '@/lib/types';
import { money, duesBadge, fmtWeekday, fmtTime, relativeDay } from '@/lib/format';
import {
  duesFor, currentMember,
} from '@/lib/session';
import { NOW } from '@/lib/engagement';
import { markAnnouncementsRead } from '@/app/announcements/actions';
import { useApp } from './Providers';
import { Badge } from './ui';
import { MemberAvatar } from './MemberAvatar';
import { PaidPill } from './FinancesScreen';

type Props = {
  members: MemberRow[]; stats: ChapterStats; events: EventRow[]; announcements: AnnouncementRow[];
  myMembershipId?: string | null; myReadIds?: string[]; live?: boolean;
};

const isPast = (e: EventRow): boolean => new Date(e.startsAt).getTime() < NOW.getTime();
const upcomingEvents = (events: EventRow[]): EventRow[] =>
  events.filter((e) => !isPast(e)).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function MiniDate({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <div style={{ width: 44, flexShrink: 0, textAlign: 'center', borderRadius: 'var(--radius-sm)', border: '1px solid var(--cream-400)', padding: '5px 0', lineHeight: 1.1 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--pkp-primary)' }}>{MONTHS[d.getMonth()]}</div>
      <div className="pkp-mono" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-900)' }}>{d.getDate()}</div>
    </div>
  );
}

export function DashboardScreen({ members, stats, events, announcements, myMembershipId = null, myReadIds = [], live = false }: Props) {
  const { role, persona } = useApp();
  if (role === 'member') {
    // Live: resolve the signed-in member by real membership id; mock/demo: fall
    // back to the persona-name lookup (matches Finances/Socials/Points).
    const me = myMembershipId
      ? members.find((m) => m.membershipId === myMembershipId)
      : currentMember(members, persona);
    if (me) return <MemberDashboard member={me} members={members} events={events} />;
  }
  return <ExecDashboard members={members} stats={stats} events={events} announcements={announcements} myReadIds={myReadIds} live={live} />;
}

/* Points leaderboard card — the top-5 by points, shared by both the officer and
   member dashboards. `highlightId` marks the signed-in member's own row. */
function PointsLeadersCard({ members, highlightId }: { members: MemberRow[]; highlightId?: string | null }) {
  const leaders = [...members].sort((a, b) => b.points - a.points).slice(0, 5);
  // Clamp to the top positive total — points can be ≤0 (−5 floor), so a negative
  // member must render as an empty bar, not a negative width.
  const topPoints = Math.max(1, ...leaders.map((m) => Math.max(0, m.points)));
  return (
    <div className="pkp-card" style={{ padding: 20 }}>
      <h3 className="pkp-h3" style={{ marginBottom: 14 }}>Points leaders</h3>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {leaders.map((m, i) => {
          const isMe = !!highlightId && m.membershipId === highlightId;
          return (
            <div key={m.membershipId} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: i ? '1px solid var(--cream-200)' : 'none' }}>
              <div className="pkp-mono" style={{ width: 18, textAlign: 'center', fontSize: 13, fontWeight: 700, color: i < 3 ? 'var(--pkp-primary)' : 'var(--ink-400)' }}>{i + 1}</div>
              <MemberAvatar name={m.fullName} src={m.avatarUrl} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: isMe ? 700 : 600, color: isMe ? 'var(--pkp-primary)' : 'var(--ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.fullName}{isMe && ' · You'}
                </div>
                <div style={{ height: 5, borderRadius: 999, background: 'var(--cream-300)', overflow: 'hidden', marginTop: 5 }}>
                  <div style={{ width: `${(Math.max(0, m.points) / topPoints) * 100}%`, height: '100%', borderRadius: 999, background: 'var(--pkp-accent)' }} />
                </div>
              </div>
              <div className="pkp-mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-700)' }}>{m.points}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── Member: dues front and center ─────────────────────────── */

function MemberDashboard({ member: m, members, events }: { member: MemberRow; members: MemberRow[]; events: EventRow[] }) {
  const { termLabel } = useApp();
  const db = duesBadge(m.duesState);
  const dues = duesFor(m);
  const pct = Math.min(100, Math.round((dues.paid / dues.charged) * 100));
  const settled = dues.balance === 0;
  const next = upcomingEvents(events).slice(0, 3);

  return (
    <div className="pkp-grid-main" style={{ gap: 16, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {settled ? (
        <PaidPill label="Dues paid in full" sub={termLabel} />
      ) : (
        <div className="pkp-card pkp-card--feature" style={{ padding: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-500)' }}>Dues balance</div>
              <div className="pkp-mono" style={{ fontSize: 52, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.02, marginTop: 6, color: 'var(--pkp-primary)' }}>{money(dues.balance)}</div>
              <div style={{ fontSize: 13.5, color: 'var(--ink-500)', marginTop: 8 }}>{termLabel}</div>
            </div>
            <Badge tone={db.tone}>{db.label}</Badge>
          </div>

          <div style={{ marginTop: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--ink-500)', marginBottom: 7 }}>
              <span>{money(dues.paid)} paid</span><span>{money(dues.balance)} remaining</span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: 'var(--cream-300)', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: 'var(--pkp-primary)' }} />
            </div>
          </div>

          <button className="pkp-btn-primary" style={{ width: '100%', height: 46, fontSize: 14.5, marginTop: 22, boxShadow: 'var(--shadow-sm)' }}>
            Pay {money(dues.balance)} dues
          </button>
        </div>
      )}

      <div className="pkp-card" style={{ padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h3 className="pkp-h3" style={{ marginBottom: 2 }}>Earn points</h3>
          <div style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>Did something on the accountability list? Log it for an officer to approve.</div>
        </div>
        <Link href="/points" onClick={() => sessionStorage.setItem('pkp-open-points-log', '1')}
          className="pkp-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', height: 40, padding: '0 18px', fontSize: 13.5, textDecoration: 'none', flexShrink: 0 }}>
          Log points
        </Link>
      </div>

      <div className="pkp-card" style={{ padding: 20 }}>
        <h3 className="pkp-h3" style={{ marginBottom: 14 }}>Coming up</h3>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {next.map((e, i) => (
            <Link key={e.id} href="/socials" onClick={() => sessionStorage.setItem('pkp-focus-event', e.id)}
              className="pkp-rowlink" style={{ display: 'flex', alignItems: 'center', gap: 12, borderTop: i ? '1px solid var(--cream-200)' : 'none', borderRadius: i ? 0 : 'var(--radius-sm)' }}>
              <MiniDate iso={e.startsAt} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-900)' }}>{e.title}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>{relativeDay(e.startsAt, NOW)} · {fmtTime(e.startsAt)}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <PointsLeadersCard members={members} highlightId={m.membershipId} />
      </div>
    </div>
  );
}

/* ─────────────────────────── Exec: officer dashboard ─────────────────────────── */

function ExecDashboard({ members, events, announcements, myReadIds = [], live = false }: Props) {
  const next = upcomingEvents(events).slice(0, 4);
  const feed = useMemo(
    () => [...announcements].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 3),
    [announcements],
  );

  // Auto-mark on view: the moment the dashboard feed is on screen, persist a
  // "read" row for every announcement it shows that the exec hasn't read yet —
  // no manual click. A ref tracks what we've sent so re-renders don't re-POST.
  // Live only; mock mode has no read store. Mirrors AnnouncementsScreen.
  const readIds = useMemo(() => new Set(myReadIds), [myReadIds]);
  const sentRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!live) return;
    const toMark = feed.map((a) => a.id).filter((id) => !readIds.has(id) && !sentRef.current.has(id));
    if (toMark.length === 0) return;
    toMark.forEach((id) => sentRef.current.add(id));
    markAnnouncementsRead(toMark).catch(() => {
      toMark.forEach((id) => sentRef.current.delete(id)); // let a later render retry
    });
  }, [feed, readIds, live]);

  return (
    <>
      <div className="pkp-grid-main" style={{ gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="pkp-card" style={{ padding: 20 }}>
            <h3 className="pkp-h3" style={{ marginBottom: 14 }}>Upcoming events</h3>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {next.map((e, i) => (
                <Link key={e.id} href="/socials" onClick={() => sessionStorage.setItem('pkp-focus-event', e.id)}
                  className="pkp-rowlink" style={{ display: 'flex', alignItems: 'center', gap: 12, borderTop: i ? '1px solid var(--cream-200)' : 'none', borderRadius: i ? 0 : 'var(--radius-sm)' }}>
                  <MiniDate iso={e.startsAt} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-900)' }}>{e.title}</span>
                      {e.mandatory && <Badge tone="danger">Mandatory</Badge>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>{fmtWeekday(e.startsAt)} · {fmtTime(e.startsAt)} · {e.location}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div className="pkp-card" style={{ padding: 20 }}>
            <h3 className="pkp-h3" style={{ marginBottom: 14 }}>Recent announcements</h3>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {feed.map((a, i) => (
                <div key={a.id} style={{ padding: '11px 0', borderTop: i ? '1px solid var(--cream-200)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-900)' }}>{a.title}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--ink-400)', flexShrink: 0 }}>{relativeDay(a.createdAt, NOW)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginTop: 2 }}>{a.author} · {a.authorRole}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <PointsLeadersCard members={members} />
        </div>
      </div>
    </>
  );
}
