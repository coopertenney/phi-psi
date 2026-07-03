'use client';

import Link from 'next/link';
import type {
  MemberRow, ChapterStats, EventRow, AnnouncementRow, RsvpState, FlagSeverity,
} from '@/lib/types';
import { money, duesBadge, fmtWeekday, fmtTime, relativeDay, type BadgeTone } from '@/lib/format';
import {
  CURRENT_QUARTER_LABEL, duesFor, currentMember,
} from '@/lib/session';
import { NOW, rsvpFor } from '@/lib/engagement';
import { useApp } from './Providers';
import { Avatar, Badge } from './ui';
import { PaidPill } from './FinancesScreen';

type Props = { members: MemberRow[]; stats: ChapterStats; events: EventRow[]; announcements: AnnouncementRow[] };

const isPast = (e: EventRow): boolean => new Date(e.startsAt).getTime() < NOW.getTime();
const upcomingEvents = (events: EventRow[]): EventRow[] =>
  events.filter((e) => !isPast(e)).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

const RSVP_META: Record<RsvpState, { tone: BadgeTone; label: string }> = {
  going: { tone: 'success', label: 'Going' },
  maybe: { tone: 'warning', label: 'Maybe' },
  no: { tone: 'neutral', label: 'Not going' },
};

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

export function DashboardScreen({ members, stats, events, announcements }: Props) {
  const { role, persona } = useApp();
  if (role === 'member') {
    const me = currentMember(members, persona);
    if (me) return <MemberDashboard member={me} events={events} />;
  }
  return <ExecDashboard members={members} stats={stats} events={events} announcements={announcements} />;
}

/* ─────────────────────────── Member: dues front and center ─────────────────────────── */

function MemberDashboard({ member: m, events }: { member: MemberRow; events: EventRow[] }) {
  const db = duesBadge(m.duesState);
  const dues = duesFor(m);
  const pct = Math.min(100, Math.round((dues.paid / dues.charged) * 100));
  const settled = dues.balance === 0;
  const next = upcomingEvents(events).slice(0, 3);

  return (
    <>
      {settled ? (
        <PaidPill label="Dues paid in full" sub={CURRENT_QUARTER_LABEL} />
      ) : (
        <div className="pkp-card" style={{ padding: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-500)' }}>Dues balance</div>
              <div className="pkp-mono" style={{ fontSize: 52, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.02, marginTop: 6, color: 'var(--pkp-primary)' }}>{money(dues.balance)}</div>
              <div style={{ fontSize: 13.5, color: 'var(--ink-500)', marginTop: 8 }}>{CURRENT_QUARTER_LABEL}</div>
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
          {next.map((e, i) => {
            const r = rsvpFor(m.membershipId, e.id, e.type, e.mandatory);
            return (
              <Link key={e.id} href="/events" onClick={() => sessionStorage.setItem('pkp-focus-event', e.id)}
                className="pkp-rowlink" style={{ display: 'flex', alignItems: 'center', gap: 12, borderTop: i ? '1px solid var(--cream-200)' : 'none', borderRadius: i ? 0 : 'var(--radius-sm)' }}>
                <MiniDate iso={e.startsAt} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-900)' }}>{e.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>{relativeDay(e.startsAt, NOW)} · {fmtTime(e.startsAt)}</div>
                </div>
                {r ? <Badge tone={RSVP_META[r].tone}>{RSVP_META[r].label}</Badge> : <Badge tone="neutral">No RSVP</Badge>}
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────── Exec: officer dashboard ─────────────────────────── */

const FLAG_TONE: Record<FlagSeverity, BadgeTone> = { danger: 'danger', warning: 'warning', info: 'info' };
const topFlag = (m: MemberRow): FlagSeverity =>
  m.flags.some((f) => f.severity === 'danger') ? 'danger'
  : m.flags.some((f) => f.severity === 'warning') ? 'warning' : 'info';

function ExecDashboard({ members, stats: s, events, announcements }: Props) {
  // Dues figures come from the live chapter_stats view (real dues_charges +
  // payments), so the headline matches the database, not a flat per-quarter
  // constant. (Fines aren't modeled in the schema yet, so they're omitted.)
  const collected = s.collectedCents;
  const target = s.targetCents;
  const duesOutstanding = Math.max(0, target - collected);

  const cards = [
    { val: String(s.activeMembers), top: 'var(--hunter-500)', label: 'Active brothers', sub: `of ${s.totalMembers} initiated` },
    { val: `${target ? Math.round((collected / target) * 100) : 0}%`, top: 'var(--pkp-primary)', label: 'Dues collected', sub: `${money(collected)} of ${money(target)}` },
    { val: `${s.avgAttendancePct}%`, top: 'var(--info-500)', label: 'Avg attendance', sub: 'last 12 meetings' },
    { val: money(duesOutstanding), top: 'var(--warning-500)', label: 'Outstanding', sub: `${money(duesOutstanding)} in unpaid dues` },
  ];

  const next = upcomingEvents(events).slice(0, 4);
  const leaders = [...members].sort((a, b) => b.points - a.points).slice(0, 5);
  // Clamp to the top positive total — points can be ≤0 (−5 floor), so a negative
  // member must render as an empty bar, not a negative width.
  const topPoints = Math.max(1, ...leaders.map((m) => Math.max(0, m.points)));
  const feed = [...announcements].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 3);
  const flagged = members.filter((m) => m.flags.length > 0)
    .sort((a, b) => Number(topFlag(b) === 'danger') - Number(topFlag(a) === 'danger'));

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        {cards.map((c) => (
          <div key={c.label} className="pkp-stat">
            <div className="pkp-stat-val">{c.val}</div>
            <div className="pkp-stat-label">{c.label}</div>
            <div className="pkp-stat-sub">{c.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="pkp-card" style={{ padding: 20 }}>
            <h3 className="pkp-h3" style={{ marginBottom: 14 }}>Upcoming events</h3>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {next.map((e, i) => (
                <Link key={e.id} href="/events" onClick={() => sessionStorage.setItem('pkp-focus-event', e.id)}
                  className="pkp-rowlink" style={{ display: 'flex', alignItems: 'center', gap: 12, borderTop: i ? '1px solid var(--cream-200)' : 'none', borderRadius: i ? 0 : 'var(--radius-sm)' }}>
                  <MiniDate iso={e.startsAt} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-900)' }}>{e.title}</span>
                      {e.mandatory && <Badge tone="danger">Mandatory</Badge>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>{fmtWeekday(e.startsAt)} · {fmtTime(e.startsAt)} · {e.location}</div>
                  </div>
                  <div className="pkp-mono pkp-r" style={{ fontSize: 13, color: 'var(--ink-600)', flexShrink: 0 }}>{e.rsvp.going} going</div>
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
          <div className="pkp-card" style={{ padding: 20 }}>
            <h3 className="pkp-h3" style={{ marginBottom: 14 }}>Points leaders</h3>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {leaders.map((m, i) => (
                <div key={m.membershipId} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: i ? '1px solid var(--cream-200)' : 'none' }}>
                  <div className="pkp-mono" style={{ width: 18, textAlign: 'center', fontSize: 13, fontWeight: 700, color: i < 3 ? 'var(--pkp-primary)' : 'var(--ink-400)' }}>{i + 1}</div>
                  <Avatar name={m.fullName} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.fullName}</div>
                    <div style={{ height: 5, borderRadius: 999, background: 'var(--cream-300)', overflow: 'hidden', marginTop: 5 }}>
                      <div style={{ width: `${(Math.max(0, m.points) / topPoints) * 100}%`, height: '100%', borderRadius: 999, background: 'var(--pkp-accent)' }} />
                    </div>
                  </div>
                  <div className="pkp-mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-700)' }}>{m.points}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="pkp-card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 className="pkp-h3">Needs attention</h3>
              <span className="pkp-mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--pkp-primary)' }}>{flagged.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {flagged.map((m, i) => (
                <div key={m.membershipId} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: i ? '1px solid var(--cream-200)' : 'none' }}>
                  <Avatar name={m.fullName} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>{m.fullName}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.flags[0].label}</div>
                  </div>
                  <Badge tone={FLAG_TONE[topFlag(m)]}>{m.flags.length}</Badge>
                </div>
              ))}
              {flagged.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-500)' }}>All clear.</div>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
