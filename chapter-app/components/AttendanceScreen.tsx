'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MemberRow, MeetingRow, AttendanceRecord, AttendanceState, MemberTermStatus, TermStatusKind } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { currentMember } from '@/lib/session';
import { recordAttendance, setTermStatus, clearTermStatus, setMeetingCheckin, checkinStatus, selfCheckIn } from '@/app/points/actions';
import { useApp } from './Providers';
import { Avatar, Badge, StatCards } from './ui';
import { Modal, ModalActions, Field, Select } from './form';

const ATT_COLOR: Record<AttendanceState, string> = {
  present: 'var(--success-500)',
  late: 'var(--warning-500)',
  absent: 'var(--ink-300)',
  excused: 'var(--info-500)',
  abroad: '#7c5cbf',
};
const ATT_LABEL: Record<AttendanceState, string> = {
  present: 'Present', late: 'Late', absent: 'Absent', excused: 'Excused', abroad: 'Abroad',
};
// Order shown in the picker / legend.
const ATT_ORDER: AttendanceState[] = ['present', 'late', 'absent', 'excused', 'abroad'];

// Attendance % = present / (present + absent). late/excused/abroad are neutral —
// dropped from the denominator. null = no graded meetings yet (e.g. abroad all
// term): shown as "—", NOT a penalizing 0%, and excluded from the chapter
// average so the SQL avg() (which ignores the NULL attendance_pct) agrees.
// Must stay in lockstep with attendance-v2.sql.
const pctFrom = (states: AttendanceState[]): number | null => {
  const graded = states.filter((s) => s === 'present' || s === 'absent').length;
  return graded ? Math.round((states.filter((s) => s === 'present').length / graded) * 100) : null;
};

type Props = {
  members: MemberRow[];
  meetings: MeetingRow[];
  attendance: AttendanceRecord[];
  memberTermStatuses?: MemberTermStatus[];
  myMembershipId?: string | null;
  live?: boolean;
};

export function AttendanceScreen({ members, meetings, attendance, memberTermStatuses = [], myMembershipId = null, live = false }: Props) {
  const { role, persona } = useApp();
  if (role === 'member') {
    const me = myMembershipId
      ? members.find((m) => m.membershipId === myMembershipId)
      : currentMember(members, persona);
    const rec = me && attendance.find((a) => a.membershipId === me.membershipId);
    const myStatus = me ? memberTermStatuses.find((s) => s.membershipId === me.membershipId) ?? null : null;
    return me && rec
      ? <MemberAttendance me={me} meetings={meetings} states={rec.states} status={myStatus} live={live} />
      : <p style={{ color: 'var(--ink-500)' }}>No record on file.</p>;
  }
  return (
    <ExecAttendance
      members={members} meetings={meetings} attendance={attendance}
      memberTermStatuses={memberTermStatuses} live={live}
    />
  );
}

/* ─────────────────────────── Shared bits ─────────────────────────── */

function Dot({ state }: { state: AttendanceState }) {
  return <span title={ATT_LABEL[state]} style={{ width: 13, height: 13, borderRadius: 4, flexShrink: 0, background: ATT_COLOR[state] }} />;
}

function Legend() {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {ATT_ORDER.map((s) => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: ATT_COLOR[s] }} />
          <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>{ATT_LABEL[s]}</span>
        </div>
      ))}
    </div>
  );
}

function StatusTag({ status }: { status: MemberTermStatus }) {
  const label = status.kind === 'abroad' ? 'Abroad · term' : 'Excused · term';
  return (
    <span
      title={status.reason || label}
      style={{
        fontSize: 10.5, fontWeight: 700, letterSpacing: '.02em', padding: '1px 6px', borderRadius: 5,
        color: ATT_COLOR[status.kind], background: `color-mix(in srgb, ${ATT_COLOR[status.kind]} 14%, transparent)`,
        whiteSpace: 'nowrap',
      }}
    >{label}</span>
  );
}

/* ─────────────────────────── Exec ─────────────────────────── */

function ExecAttendance({ members, meetings: propMeetings, attendance, memberTermStatuses, live }: {
  members: MemberRow[]; meetings: MeetingRow[]; attendance: AttendanceRecord[]; memberTermStatuses: MemberTermStatus[]; live: boolean;
}) {
  const router = useRouter();
  // Local, optimistic model keyed by meeting id (index-free, so inserting a new
  // meeting mid-term is trivial). Seeded from props; live writes also persist.
  const [meetings, setMeetings] = useState<MeetingRow[]>(propMeetings);
  const [att, setAtt] = useState<Map<string, Map<string, AttendanceState>>>(() => {
    const m = new Map<string, Map<string, AttendanceState>>();
    for (const rec of attendance) {
      const inner = new Map<string, AttendanceState>();
      rec.states.forEach((s, i) => { if (propMeetings[i]) inner.set(propMeetings[i].id, s); });
      m.set(rec.membershipId, inner);
    }
    return m;
  });
  const [statuses, setStatuses] = useState<Map<string, MemberTermStatus>>(
    () => new Map(memberTermStatuses.map((s) => [s.membershipId, s])),
  );
  // Re-seed from props on server refresh (e.g. after members self-check-in), same
  // pattern SocialsScreen uses. Safe: live writes persist before we refresh, so
  // props are authoritative; mock props never change so local edits survive.
  useEffect(() => { setMeetings(propMeetings); }, [propMeetings]);
  useEffect(() => {
    const m = new Map<string, Map<string, AttendanceState>>();
    for (const rec of attendance) {
      const inner = new Map<string, AttendanceState>();
      rec.states.forEach((s, i) => { if (propMeetings[i]) inner.set(propMeetings[i].id, s); });
      m.set(rec.membershipId, inner);
    }
    setAtt(m);
  }, [attendance, propMeetings]);
  useEffect(() => { setStatuses(new Map(memberTermStatuses.map((s) => [s.membershipId, s]))); }, [memberTermStatuses]);
  const [taking, setTaking] = useState(false);
  const [managing, setManaging] = useState(false);
  const [checking, setChecking] = useState(false);

  const statesFor = (membershipId: string): AttendanceState[] =>
    meetings.map((mt) => att.get(membershipId)?.get(mt.id) ?? 'absent');

  const active = members.filter((m) => m.status !== 'inactive');
  // Average only over members with graded meetings — mirrors SQL avg(), which
  // ignores the NULL attendance_pct of an abroad/excused-all-term brother.
  const graded = active.map((m) => pctFrom(statesFor(m.membershipId))).filter((p): p is number => p !== null);
  const avgAtt = graded.length ? Math.round(graded.reduce((a, b) => a + b, 0) / graded.length) : 0;
  const range = meetings.length
    ? `${fmtDate(meetings[0].date)} – ${fmtDate(meetings[meetings.length - 1].date)}`
    : '—';

  const cards = [
    { val: `${avgAtt}%`, top: 'var(--info-500)', label: 'Avg attendance', sub: `${meetings.length} meetings · ${range}` },
    { val: String(active.length), top: 'var(--hunter-500)', label: 'Active brothers', sub: `of ${members.length} total` },
    { val: String(statuses.size), top: '#7c5cbf', label: 'Season statuses', sub: 'abroad / recurring excuse' },
  ];

  // Record a meeting: persist first when live (using the meeting id the action
  // returns), then apply to the local model so the grid updates immediately —
  // local state is authoritative for the session; a full reload re-seeds from
  // the server. Applies optimistically in mock mode with a temp id.
  const onRecord = async (input: { meetingId: string | null; title: string; heldOn: string; entries: { membershipId: string; state: AttendanceState }[] }) => {
    const isNew = !input.meetingId;
    let meetingId = input.meetingId ?? `local-${Date.now()}`;
    if (live) {
      try { meetingId = await recordAttendance(input); } catch (e: any) { alert(e?.message ?? 'Save failed.'); return; }
    }
    if (isNew) setMeetings((prev) => [...prev, { id: meetingId, title: input.title.trim() || 'Chapter meeting', date: input.heldOn }].sort((a, b) => a.date.localeCompare(b.date)));
    setAtt((prev) => {
      const next = new Map(prev);
      for (const e of input.entries) {
        const inner = new Map(next.get(e.membershipId) ?? []);
        inner.set(meetingId, e.state);
        next.set(e.membershipId, inner);
      }
      return next;
    });
    setTaking(false);
    if (live) router.refresh();
  };

  const onSetStatus = async (membershipId: string, kind: TermStatusKind, reason: string) => {
    if (live) {
      try { await setTermStatus(membershipId, kind, reason); } catch (e: any) { alert(e?.message ?? 'Save failed.'); return; }
    }
    setStatuses((prev) => new Map(prev).set(membershipId, { membershipId, kind, reason: reason.trim() || null }));
  };
  const onClearStatus = async (membershipId: string) => {
    if (live) {
      try { await clearTermStatus(membershipId); } catch (e: any) { alert(e?.message ?? 'Remove failed.'); return; }
    }
    setStatuses((prev) => { const next = new Map(prev); next.delete(membershipId); return next; });
  };

  return (
    <>
      <StatCards cards={cards} />

      <div className="pkp-card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
          <h3 className="pkp-h3">Meeting attendance</h3>
          <div className="pkp-files-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="pkp-btn-ghost" style={{ height: 34, padding: '0 13px', fontSize: 13 }} onClick={() => setManaging(true)}>Season statuses</button>
            <button className="pkp-btn-ghost" style={{ height: 34, padding: '0 13px', fontSize: 13 }} onClick={() => setChecking(true)}>Check-in</button>
            <button className="pkp-btn-primary" style={{ height: 34, padding: '0 14px', fontSize: 13 }} onClick={() => setTaking(true)}>Take attendance</button>
          </div>
        </div>
        <div style={{ marginBottom: 14 }}><Legend /></div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {members.map((m, i) => {
            const states = statesFor(m.membershipId);
            const pct = pctFrom(states);
            const status = statuses.get(m.membershipId);
            return (
              <div key={m.membershipId} className="pkp-att-row" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 0', borderTop: i ? '1px solid var(--cream-200)' : 'none' }}>
                <div className="pkp-att-name" style={{ display: 'flex', alignItems: 'center', gap: 10, width: 205, flexShrink: 0, minWidth: 0 }}>
                  <Avatar name={m.fullName} size={30} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.fullName}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>{m.roleLabel}</span>
                      {status && <StatusTag status={status} />}
                    </div>
                  </div>
                </div>
                <div className="pkp-att-dots" style={{ flex: 1, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {states.map((s, k) => <Dot key={k} state={s} />)}
                </div>
                <div className="pkp-mono pkp-r pkp-att-pct" style={{ width: 48, flexShrink: 0, fontSize: 14, fontWeight: 600, color: pct === null ? 'var(--ink-300)' : pct < 80 ? 'var(--pkp-primary)' : 'var(--ink-800)' }}>{pct === null ? '—' : `${pct}%`}</div>
              </div>
            );
          })}
        </div>
      </div>

      {taking && (
        <TakeAttendanceModal
          members={members} meetings={meetings} statuses={statuses}
          stateFor={(mid, meetingId) => att.get(mid)?.get(meetingId)}
          onClose={() => setTaking(false)} onSave={onRecord}
        />
      )}
      {managing && (
        <SeasonStatusModal
          members={members} statuses={statuses}
          onClose={() => setManaging(false)} onSet={onSetStatus} onClear={onClearStatus}
        />
      )}
      {checking && (
        <LiveCheckinModal
          meetings={meetings} live={live}
          onClose={() => { setChecking(false); if (live) router.refresh(); }}
          onNewMeeting={(id, title, date) => setMeetings((prev) => prev.some((m) => m.id === id) ? prev : [...prev, { id, title, date, checkinOpen: true }].sort((a, b) => a.date.localeCompare(b.date)))}
        />
      )}
    </>
  );
}

/* ─────────────────────────── Take-attendance modal ─────────────────────────── */

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function TakeAttendanceModal({ members, meetings, statuses, stateFor, onClose, onSave }: {
  members: MemberRow[];
  meetings: MeetingRow[];
  statuses: Map<string, MemberTermStatus>;
  stateFor: (membershipId: string, meetingId: string) => AttendanceState | undefined;
  onClose: () => void;
  onSave: (input: { meetingId: string | null; title: string; heldOn: string; entries: { membershipId: string; state: AttendanceState }[] }) => void;
}) {
  const [choice, setChoice] = useState<string>('new'); // 'new' | meeting id
  const [title, setTitle] = useState('Chapter meeting');
  const [heldOn, setHeldOn] = useState(todayISO());
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);

  // Prefill: existing meeting → its saved state; new meeting → the member's
  // season status (abroad/excused) or absent. Recomputed when the meeting changes.
  const prefill = (membershipId: string): AttendanceState => {
    if (choice !== 'new') {
      const saved = stateFor(membershipId, choice);
      if (saved) return saved;
    }
    return statuses.get(membershipId)?.kind ?? 'absent';
  };
  const [sel, setSel] = useState<Map<string, AttendanceState>>(() => new Map(members.map((m) => [m.membershipId, prefill(m.membershipId)])));

  const onChooseMeeting = (value: string) => {
    setChoice(value);
    // reseed selections against the newly chosen meeting
    setSel(new Map(members.map((m) => {
      if (value !== 'new') { const s = stateFor(m.membershipId, value); if (s) return [m.membershipId, s] as const; }
      return [m.membershipId, statuses.get(m.membershipId)?.kind ?? 'absent'] as const;
    })));
  };

  const setAll = (state: AttendanceState) => setSel(new Map(members.map((m) => [m.membershipId, state])));

  const shown = members.filter((m) => m.fullName.toLowerCase().includes(q.trim().toLowerCase()));
  const counts = ATT_ORDER.map((s) => [s, [...sel.values()].filter((v) => v === s).length] as const);

  const submit = () => {
    setSaving(true);
    onSave({
      meetingId: choice === 'new' ? null : choice,
      title, heldOn,
      entries: members.map((m) => ({ membershipId: m.membershipId, state: sel.get(m.membershipId) ?? 'absent' })),
    });
  };

  const meetingOptions = [
    { value: 'new', label: '＋ New meeting' },
    ...meetings.map((mt) => ({ value: mt.id, label: `${fmtDate(mt.date)} · ${mt.title}` })),
  ];

  return (
    <Modal title="Take attendance" sub="Mark each brother. Season statuses are pre-filled." onClose={onClose} width={560}
      footer={<ModalActions onCancel={onClose} onSave={submit} saveLabel={saving ? 'Saving…' : 'Save attendance'} canSave={!saving} />}
    >
      <Select label="Meeting" value={choice} onChange={(e) => onChooseMeeting(e.target.value)} options={meetingOptions} />
      {choice === 'new' && (
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div style={{ width: 150 }}><Field label="Date" type="date" value={heldOn} onChange={(e) => setHeldOn(e.target.value)} /></div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, margin: '12px 0 8px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>
          {counts.filter(([, n]) => n > 0).map(([s, n]) => `${n} ${ATT_LABEL[s as AttendanceState].toLowerCase()}`).join(' · ') || 'No one marked'}
        </div>
        <button className="pkp-btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setAll('present')}>All present</button>
      </div>
      <input
        placeholder="Filter brothers…" value={q} onChange={(e) => setQ(e.target.value)}
        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--cream-400)', fontSize: 13, marginBottom: 8 }}
      />

      <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', border: '1px solid var(--cream-200)', borderRadius: 10 }}>
        {shown.map((m, i) => {
          const cur = sel.get(m.membershipId) ?? 'absent';
          const status = statuses.get(m.membershipId);
          return (
            <div key={m.membershipId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderTop: i ? '1px solid var(--cream-100)' : 'none' }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 13, color: 'var(--ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.fullName}</span>
                {status && <StatusTag status={status} />}
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {ATT_ORDER.map((s) => {
                  const on = cur === s;
                  return (
                    <button
                      key={s} title={ATT_LABEL[s]} onClick={() => setSel((prev) => new Map(prev).set(m.membershipId, s))}
                      style={{
                        width: 30, height: 26, borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                        border: on ? `1.5px solid ${ATT_COLOR[s]}` : '1px solid var(--cream-400)',
                        background: on ? ATT_COLOR[s] : 'var(--white)',
                        color: on ? '#fff' : 'var(--ink-500)',
                      }}
                    >{ATT_LABEL[s][0]}</button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/* ─────────────────────────── Season-status modal ─────────────────────────── */

function SeasonStatusModal({ members, statuses, onClose, onSet, onClear }: {
  members: MemberRow[];
  statuses: Map<string, MemberTermStatus>;
  onClose: () => void;
  onSet: (membershipId: string, kind: TermStatusKind, reason: string) => void;
  onClear: (membershipId: string) => void;
}) {
  const [membershipId, setMembershipId] = useState(members[0]?.membershipId ?? '');
  const [kind, setKind] = useState<TermStatusKind>('abroad');
  const [reason, setReason] = useState('');

  const add = () => {
    if (!membershipId) return;
    onSet(membershipId, kind, reason);
    setReason('');
  };

  const active = members
    .map((m) => ({ m, s: statuses.get(m.membershipId) }))
    .filter((x): x is { m: MemberRow; s: MemberTermStatus } => !!x.s);

  return (
    <Modal title="Season statuses" sub="All-quarter status: abroad, or a recurring excuse with a reason." onClose={onClose} width={480}>
      <Select label="Brother" value={membershipId} onChange={(e) => setMembershipId(e.target.value)}
        options={members.map((m) => ({ value: m.membershipId, label: m.fullName }))} />
      <Select label="Status" value={kind} onChange={(e) => setKind(e.target.value as TermStatusKind)}
        options={[{ value: 'abroad', label: 'Abroad (all term)' }, { value: 'excused', label: 'Recurring excuse' }]} />
      <Field label="Reason" placeholder={kind === 'abroad' ? 'e.g. Studying in Florence' : 'e.g. Varsity practice conflict'} value={reason} onChange={(e) => setReason(e.target.value)} />
      <div style={{ marginTop: 4 }}>
        <button className="pkp-btn-primary" style={{ height: 36, padding: '0 16px', fontSize: 13 }} onClick={add}>Set status</button>
      </div>

      {active.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-500)', marginBottom: 8 }}>Current ({active.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {active.map(({ m, s }) => (
              <div key={m.membershipId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', border: '1px solid var(--cream-200)', borderRadius: 8 }}>
                <StatusTag status={s} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--ink-900)' }}>{m.fullName}</div>
                  {s.reason && <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>{s.reason}</div>}
                </div>
                <button className="pkp-btn pkp-btn-ghost" style={{ fontSize: 12, padding: '4px 9px' }} onClick={() => onClear(m.membershipId)}>Remove</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ─────────────────────────── Live check-in (exec) ─────────────────────────── */

function LiveCheckinModal({ meetings, live, onClose, onNewMeeting }: {
  meetings: MeetingRow[];
  live: boolean;
  onClose: () => void;
  onNewMeeting: (id: string, title: string, date: string) => void;
}) {
  const existingOpen = meetings.find((m) => m.checkinOpen) ?? null;
  const [choice, setChoice] = useState<string>(existingOpen?.id ?? 'new');
  const [title, setTitle] = useState('Chapter meeting');
  const [heldOn, setHeldOn] = useState(todayISO());
  const [meetingId, setMeetingId] = useState<string | null>(existingOpen?.id ?? null);
  const [open, setOpen] = useState<boolean>(!!existingOpen);
  const [code, setCode] = useState<string | null>(null);
  const [present, setPresent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Poll the rotating code + checked-in count while open.
  useEffect(() => {
    if (!open || !meetingId) return;
    let stop = false;
    const tick = async () => {
      if (!live) { setCode(String(((Math.floor(Date.now() / 30000)) % 900000) + 100000)); return; }
      try { const s = await checkinStatus(meetingId); if (!stop) { setCode(s.code); setPresent(s.present); } } catch { /* transient */ }
    };
    tick();
    const iv = setInterval(tick, live ? 8000 : 1000);
    return () => { stop = true; clearInterval(iv); };
  }, [open, meetingId, live]);

  const openCheckin = async () => {
    setBusy(true); setErr(null);
    try {
      let id: string | null = choice === 'new' ? null : choice;
      if (live) {
        if (!id) id = await recordAttendance({ meetingId: null, title, heldOn, entries: [] });
        await setMeetingCheckin(id, true);
      } else {
        id = id ?? `local-${Date.now()}`;
      }
      if (choice === 'new' && id) onNewMeeting(id, title.trim() || 'Chapter meeting', heldOn);
      setMeetingId(id); setOpen(true);
    } catch (e: any) { setErr(e?.message ?? 'Could not open check-in.'); }
    finally { setBusy(false); }
  };

  const closeCheckin = async () => {
    setBusy(true); setErr(null);
    try { if (live && meetingId) await setMeetingCheckin(meetingId, false); onClose(); }
    catch (e: any) { setErr(e?.message ?? 'Could not close check-in.'); setBusy(false); }
  };

  const meetingOptions = [
    { value: 'new', label: '＋ New meeting' },
    ...meetings.map((mt) => ({ value: mt.id, label: `${fmtDate(mt.date)} · ${mt.title}${mt.checkinOpen ? ' · open' : ''}` })),
  ];

  return (
    <Modal title="Live check-in" sub="Members type the code on their phone to mark themselves present." onClose={onClose} width={460}
      footer={open
        ? <button className="pkp-btn-ghost" style={{ height: 38, padding: '0 16px', fontSize: 13.5 }} disabled={busy} onClick={closeCheckin}>{busy ? 'Closing…' : 'Close check-in'}</button>
        : <ModalActions onCancel={onClose} onSave={openCheckin} saveLabel={busy ? 'Opening…' : 'Open check-in'} canSave={!busy} />}
    >
      {!open ? (
        <>
          <Select label="Meeting" value={choice} onChange={(e) => setChoice(e.target.value)} options={meetingOptions} />
          {choice === 'new' && (
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}><Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div style={{ width: 150 }}><Field label="Date" type="date" value={heldOn} onChange={(e) => setHeldOn(e.target.value)} /></div>
            </div>
          )}
          <p style={{ fontSize: 12.5, color: 'var(--ink-500)', marginTop: 10 }}>
            Opening shows a 6-digit code that rotates every 30s. Brothers enter it under Points &amp; Attendance to check in.
          </p>
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-500)' }}>Check-in code</div>
          <div className="pkp-mono" style={{ fontSize: 52, fontWeight: 700, letterSpacing: '.14em', color: 'var(--pkp-primary)', margin: '10px 0 4px' }}>
            {code ?? '••••••'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>rotates every 30s</div>
          <div style={{ marginTop: 18, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 999, background: 'var(--success-100)', color: 'var(--success-600)', fontSize: 13.5, fontWeight: 600 }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--success-500)' }} /> {present} checked in
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-500)', marginTop: 16 }}>Read it aloud or project it. Close check-in when chapter starts.</p>
        </div>
      )}
      {err && <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--danger-600)' }}>{err}</div>}
    </Modal>
  );
}

/* ─────────────────────────── Member ─────────────────────────── */

function MemberAttendance({ me, meetings, states, status, live }: { me: MemberRow; meetings: MeetingRow[]; states: AttendanceState[]; status: MemberTermStatus | null; live: boolean }) {
  const pct = pctFrom(states);
  const counts = ATT_ORDER.map((s) => [s, states.filter((x) => x === s).length] as const).filter(([, n]) => n > 0);
  const openMeeting = meetings.find((m) => m.checkinOpen);

  return (
    <div style={{ maxWidth: 660, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {openMeeting && <MemberCheckinCard meeting={openMeeting} live={live} />}
      <div className="pkp-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-500)' }}>Your attendance</div>
            <div className="pkp-mono" style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.05, marginTop: 6, color: pct !== null && pct < 80 ? 'var(--pkp-primary)' : 'var(--ink-900)' }}>{pct === null ? '—' : `${pct}%`}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 6 }}>
              {counts.map(([s, n]) => `${n} ${ATT_LABEL[s as AttendanceState].toLowerCase()}`).join(' · ') || 'No meetings yet'} · {meetings.length} meetings
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            {pct === null
              ? <Badge tone="neutral">{status ? (status.kind === 'abroad' ? 'Abroad this term' : 'Excused this term') : 'No graded meetings'}</Badge>
              : <Badge tone={pct < 80 ? 'danger' : pct < 95 ? 'warning' : 'success'}>
                  {pct < 80 ? 'Below minimum' : pct < 95 ? 'On watch' : 'In good standing'}
                </Badge>}
            {status && <StatusTag status={status} />}
          </div>
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

/* ─────────────────────────── Member check-in card ─────────────────────────── */

function MemberCheckinCard({ meeting, live }: { meeting: MeetingRow; live: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (code.trim().length < 4) return;
    setBusy(true); setErr(null);
    try {
      if (live) await selfCheckIn(meeting.id, code);
      setDone(true);
      if (live) router.refresh();
    } catch (e: any) { setErr(e?.message ?? 'Check-in failed.'); }
    finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="pkp-card" style={{ padding: 20, border: '1px solid var(--success-300)', background: 'color-mix(in srgb, var(--success-500) 7%, transparent)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 30, height: 30, borderRadius: 999, background: 'var(--success-500)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>✓</span>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink-900)' }}>You’re checked in</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>Marked present for {meeting.title}.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="pkp-card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--success-500)' }} />
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--success-600)' }}>Check-in open</div>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-900)' }}>Check in to {meeting.title}</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginTop: 3, marginBottom: 14 }}>Enter the 6-digit code shown on the screen at chapter.</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <input
          inputMode="numeric" pattern="[0-9]*" maxLength={6} placeholder="000000" value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          className="pkp-mono"
          style={{ flex: 1, fontSize: 22, letterSpacing: '.2em', textAlign: 'center', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--cream-400)' }}
        />
        <button className="pkp-btn-primary" style={{ padding: '0 18px', fontSize: 14, fontWeight: 600 }} disabled={busy || code.length < 4} onClick={submit}>
          {busy ? '…' : 'Check in'}
        </button>
      </div>
      {err && <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--danger-600)' }}>{err}</div>}
    </div>
  );
}
