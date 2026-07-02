'use client';

import { useMemo } from 'react';
import type { MemberRow, MeetingRow, AttendanceRecord, AttendanceState } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { currentMember } from '@/lib/session';
import { useApp } from './Providers';
import { Avatar, Badge } from './ui';

const ATT_COLOR: Record<AttendanceState, string> = {
  present: 'var(--success-500)',
  excused: 'var(--warning-500)',
  absent: 'var(--ink-300)',
};
const ATT_LABEL: Record<AttendanceState, string> = { present: 'Present', excused: 'Excused', absent: 'Absent' };

const pctFrom = (states: AttendanceState[]): number =>
  states.length ? Math.round((states.filter((s) => s === 'present').length / states.length) * 100) : 0;

type Props = { members: MemberRow[]; meetings: MeetingRow[]; attendance: AttendanceRecord[] };

export function AttendanceScreen({ members, meetings, attendance }: Props) {
  const { role, persona } = useApp();
  if (role === 'member') {
    const me = currentMember(members, persona);
    const rec = me && attendance.find((a) => a.membershipId === me.membershipId);
    return me && rec
      ? <MemberAttendance me={me} meetings={meetings} states={rec.states} />
      : <p style={{ color: 'var(--ink-500)' }}>No record on file.</p>;
  }
  return <ExecAttendance members={members} meetings={meetings} attendance={attendance} />;
}

/* ─────────────────────────── Exec ─────────────────────────── */

function Dot({ state }: { state: AttendanceState }) {
  return <span title={ATT_LABEL[state]} style={{ width: 13, height: 13, borderRadius: 4, flexShrink: 0, background: ATT_COLOR[state] }} />;
}

function Legend() {
  return (
    <div style={{ display: 'flex', gap: 14 }}>
      {(['present', 'excused', 'absent'] as AttendanceState[]).map((s) => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: ATT_COLOR[s] }} />
          <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>{ATT_LABEL[s]}</span>
        </div>
      ))}
    </div>
  );
}

function ExecAttendance({ members, meetings, attendance }: Props) {
  const byId = useMemo(() => new Map(attendance.map((a) => [a.membershipId, a.states])), [attendance]);
  const active = members.filter((m) => m.status !== 'inactive');
  const avgAtt = active.length
    ? Math.round(active.reduce((a, m) => a + pctFrom(byId.get(m.membershipId) ?? []), 0) / active.length)
    : 0;

  const range = meetings.length
    ? `${fmtDate(meetings[0].date)} – ${fmtDate(meetings[meetings.length - 1].date)}`
    : '';

  const cards = [
    { val: `${avgAtt}%`, top: 'var(--info-500)', label: 'Avg attendance', sub: `${meetings.length} meetings · ${range}` },
    { val: String(active.length), top: 'var(--hunter-500)', label: 'Active brothers', sub: `of ${members.length} total` },
    { val: String(meetings.length), top: 'var(--pkp-primary)', label: 'Meetings held', sub: 'this term' },
  ];

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
        {cards.map((c) => (
          <div key={c.label} className="pkp-stat">
            <div className="pkp-stat-val">{c.val}</div>
            <div className="pkp-stat-label">{c.label}</div>
            <div className="pkp-stat-sub">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="pkp-card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
          <h3 className="pkp-h3">Meeting attendance</h3>
          <Legend />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {members.map((m, i) => {
            const states = byId.get(m.membershipId) ?? [];
            const pct = pctFrom(states);
            return (
              <div key={m.membershipId} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 0', borderTop: i ? '1px solid var(--cream-200)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: 190, flexShrink: 0, minWidth: 0 }}>
                  <Avatar name={m.fullName} size={30} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.fullName}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>{m.roleLabel}</div>
                  </div>
                </div>
                <div style={{ flex: 1, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {states.map((s, k) => <Dot key={k} state={s} />)}
                </div>
                <div className="pkp-mono pkp-r" style={{ width: 48, flexShrink: 0, fontSize: 14, fontWeight: 600, color: pct < 80 ? 'var(--pkp-primary)' : 'var(--ink-800)' }}>{pct}%</div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────── Member ─────────────────────────── */

function MemberAttendance({ me, meetings, states }: { me: MemberRow; meetings: MeetingRow[]; states: AttendanceState[] }) {
  const pct = pctFrom(states);
  const counts = {
    present: states.filter((s) => s === 'present').length,
    excused: states.filter((s) => s === 'excused').length,
    absent: states.filter((s) => s === 'absent').length,
  };

  return (
    <div style={{ maxWidth: 660, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="pkp-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-500)' }}>Your attendance</div>
            <div className="pkp-mono" style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.05, marginTop: 6, color: pct < 80 ? 'var(--pkp-primary)' : 'var(--ink-900)' }}>{pct}%</div>
            <div style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 6 }}>{counts.present} present · {counts.excused} excused · {counts.absent} absent · {meetings.length} meetings</div>
          </div>
          <Badge tone={pct < 80 ? 'danger' : pct < 95 ? 'warning' : 'success'}>
            {pct < 80 ? 'Below minimum' : pct < 95 ? 'On watch' : 'In good standing'}
          </Badge>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 18 }}>
          {states.map((s, k) => (
            <span key={k} title={`${fmtDate(meetings[k]?.date ?? '')} · ${ATT_LABEL[s]}`}
              style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, background: ATT_COLOR[s] }} />
          ))}
        </div>
      </div>
    </div>
  );
}
