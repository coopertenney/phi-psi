'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EventRow, EventType, MemberRow, RsvpState, AttendanceState } from '@/lib/types';
import type { EventRsvp } from '@/lib/data';
import { fmtWeekday, fmtTime, relativeDay, type BadgeTone } from '@/lib/format';
import { NOW } from '@/lib/engagement';
import { currentMember } from '@/lib/session';
import { createEvent, updateEvent, deleteEvent, setRsvp, setAttendance, type EventInput } from '@/app/events/actions';
import { useApp } from './Providers';
import { Avatar, Badge } from './ui';
import { icons } from './icons';
import { Modal, Field, Select, TextArea, FieldRow, Checkbox } from './form';

/* ─────────────────────────── Shared bits ─────────────────────────── */

const TYPE_META: Record<EventType, { label: string; tone: BadgeTone }> = {
  meeting: { label: 'Meeting', tone: 'neutral' },
  philanthropy: { label: 'Philanthropy', tone: 'success' },
  social: { label: 'Social', tone: 'info' },
  brotherhood: { label: 'Brotherhood', tone: 'warning' },
  service: { label: 'Service', tone: 'success' },
  mandatory: { label: 'Mandatory', tone: 'danger' },
  recruitment: { label: 'Recruitment', tone: 'info' },
};
const typeMeta = (t: string) => TYPE_META[t as EventType] ?? { label: t, tone: 'neutral' as BadgeTone };

const RSVP_META: Record<RsvpState, { tone: BadgeTone; label: string }> = {
  going: { tone: 'success', label: 'Going' },
  maybe: { tone: 'warning', label: 'Maybe' },
  no: { tone: 'neutral', label: 'Not going' },
};

const isPast = (e: EventRow): boolean => new Date(e.startsAt).getTime() < NOW.getTime();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// event id → (membership id → their RSVP)
type RsvpIndex = Map<string, Map<string, RsvpState>>;
function buildIndex(rsvps: EventRsvp[]): RsvpIndex {
  const idx: RsvpIndex = new Map();
  for (const r of rsvps) {
    if (!idx.has(r.eventId)) idx.set(r.eventId, new Map());
    idx.get(r.eventId)!.set(r.membershipId, r.status);
  }
  return idx;
}

const toInput = (e: EventRow): EventInput => ({
  title: e.title, type: e.type, startsAt: e.startsAt, endsAt: e.endsAt,
  location: e.location, description: e.description, mandatory: e.mandatory, pointsValue: e.pointsValue,
});

function DateBlock({ iso, muted }: { iso: string; muted?: boolean }) {
  const d = new Date(iso);
  return (
    <div style={{
      width: 52, flexShrink: 0, textAlign: 'center', borderRadius: 'var(--radius-md)',
      border: '1px solid var(--cream-400)', background: muted ? 'var(--cream-100)' : 'var(--white)',
      padding: '7px 0', lineHeight: 1.1,
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: muted ? 'var(--ink-400)' : 'var(--pkp-primary)' }}>{MONTHS[d.getMonth()]}</div>
      <div className="pkp-mono" style={{ fontSize: 20, fontWeight: 600, color: muted ? 'var(--ink-500)' : 'var(--ink-900)' }}>{d.getDate()}</div>
    </div>
  );
}

function RsvpBar({ rsvp }: { rsvp: EventRow['rsvp'] }) {
  const total = rsvp.going + rsvp.maybe + rsvp.no || 1;
  const seg = (n: number, color: string) =>
    n > 0 ? <div style={{ width: `${(n / total) * 100}%`, background: color }} /> : null;
  return (
    <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', background: 'var(--cream-300)' }}>
      {seg(rsvp.going, 'var(--success-500)')}
      {seg(rsvp.maybe, 'var(--warning-500)')}
      {seg(rsvp.no, 'var(--ink-300)')}
    </div>
  );
}

type Props = {
  events: EventRow[];
  members: MemberRow[];
  rsvps: EventRsvp[];
  myMembershipId: string | null;
  live: boolean;
  checkins: Record<string, Record<string, AttendanceState>>;
};

export function EventsScreen({ events, members, rsvps, myMembershipId, live, checkins }: Props) {
  const { role, persona } = useApp();
  const rsvpIndex = useMemo(() => buildIndex(rsvps), [rsvps]);

  if (role === 'member') {
    const me = live ? members.find((m) => m.membershipId === myMembershipId) : currentMember(members, persona);
    return me
      ? <MemberEvents events={events} me={me} rsvpIndex={rsvpIndex} live={live} />
      : <p style={{ color: 'var(--ink-500)' }}>Your member profile isn’t loaded yet.</p>;
  }
  return <ExecEvents events={events} members={members} rsvpIndex={rsvpIndex} live={live} checkins={checkins} />;
}

/* ─────────────────────────── Exec view ─────────────────────────── */

const CHIPS = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
  { id: 'mandatory', label: 'Mandatory' },
  { id: 'all', label: 'All' },
] as const;
type Filter = (typeof CHIPS)[number]['id'];

function ExecEvents({ events, members, rsvpIndex, live, checkins }: {
  events: EventRow[]; members: MemberRow[]; rsvpIndex: RsvpIndex; live: boolean;
  checkins: Record<string, Record<string, AttendanceState>>;
}) {
  const router = useRouter();
  const [list, setList] = useState<EventRow[]>(events);
  useEffect(() => setList(events), [events]); // follow server refreshes
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<EventRow | 'new' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const focus = sessionStorage.getItem('pkp-focus-event');
    if (focus) { setSelectedId(focus); sessionStorage.removeItem('pkp-focus-event'); }
  }, []);

  const sorted = useMemo(
    () => [...list].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [list],
  );
  const selected = list.find((e) => e.id === selectedId) ?? null;

  const save = async (e: EventRow, isNew: boolean) => {
    if (!live) {
      setList((l) => (l.some((x) => x.id === e.id) ? l.map((x) => (x.id === e.id ? e : x)) : [e, ...l]));
      setForm(null);
      return;
    }
    setBusy(true);
    try {
      if (isNew) await createEvent(toInput(e)); else await updateEvent(e.id, toInput(e));
      router.refresh();
      setForm(null);
    } catch (err: any) {
      alert(err?.message ?? 'Could not save the event.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!live) { setList((l) => l.filter((x) => x.id !== id)); setSelectedId(null); setForm(null); return; }
    setBusy(true);
    try { await deleteEvent(id); router.refresh(); setSelectedId(null); setForm(null); }
    catch (err: any) { alert(err?.message ?? 'Could not delete the event.'); }
    finally { setBusy(false); }
  };

  const rows = sorted.filter((e) =>
    filter === 'all' ? true
    : filter === 'mandatory' ? e.mandatory
    : filter === 'past' ? isPast(e)
    : !isPast(e),
  );
  const upcoming = sorted.filter((e) => !isPast(e));
  const next = upcoming[0];
  const active = members.filter((m) => m.status !== 'inactive').length;

  const cards = [
    { val: String(upcoming.length), top: 'var(--pkp-primary)', label: 'Upcoming events', sub: next ? `Next: ${next.title}` : 'None scheduled' },
    { val: next ? String(next.rsvp.going) : '—', top: 'var(--success-500)', label: 'Going to next', sub: next ? `of ${active} active brothers` : '' },
    { val: String(list.filter((e) => e.mandatory && !isPast(e)).length), top: 'var(--warning-500)', label: 'Mandatory ahead', sub: 'attendance recorded' },
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div className="pkp-chips">
          {CHIPS.map((c) => (
            <button key={c.id} className={`pkp-chip${filter === c.id ? ' on' : ''}`} onClick={() => setFilter(c.id)}>{c.label}</button>
          ))}
        </div>
        <button className="pkp-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 18px', fontSize: 13.5, boxShadow: 'var(--shadow-sm)' }} onClick={() => setForm('new')}>
          <span style={{ display: 'inline-flex' }}>{icons.plus}</span>Create event
        </button>
      </div>

      <div className="pkp-card" style={{ overflow: 'hidden' }}>
        {rows.map((e, i) => {
          const tm = typeMeta(e.type);
          const past = isPast(e);
          return (
            <div key={e.id} className="pkp-row" style={{ display: 'flex', gap: 14, alignItems: 'center', gridTemplateColumns: 'unset', borderTop: i ? '1px solid var(--cream-200)' : 'none' }} onClick={() => setSelectedId(e.id)}>
              <DateBlock iso={e.startsAt} muted={past} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink-900)' }}>{e.title}</span>
                  <Badge tone={tm.tone}>{tm.label}</Badge>
                  {e.mandatory && <Badge tone="danger">Mandatory</Badge>}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginTop: 3 }}>
                  {fmtWeekday(e.startsAt)} · {fmtTime(e.startsAt)} · {e.location}
                </div>
              </div>
              <div style={{ width: 132, flexShrink: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--ink-600)', marginBottom: 5, textAlign: 'right' }}>
                  <span style={{ fontWeight: 600, color: 'var(--ink-800)' }}>{e.rsvp.going}</span> going
                </div>
                <RsvpBar rsvp={e.rsvp} />
              </div>
              <div style={{ display: 'flex', color: 'var(--ink-400)' }}>{icons.chevron}</div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13.5, color: 'var(--ink-500)' }}>
            No events in this view.{filter !== 'past' && ' Click “Create event” to add one.'}
          </div>
        )}
      </div>

      {selected && (
        <EventDrawer
          event={selected}
          members={members}
          eventRsvps={rsvpIndex.get(selected.id) ?? new Map()}
          live={live}
          initialCheckin={checkins[selected.id] ?? {}}
          onClose={() => setSelectedId(null)}
          onEdit={() => setForm(selected)}
        />
      )}
      {form && (
        <EventFormModal
          base={form === 'new' ? undefined : form}
          busy={busy}
          onClose={() => setForm(null)}
          onSave={(e) => save(e, form === 'new')}
          onDelete={form !== 'new' ? () => remove((form as EventRow).id) : undefined}
        />
      )}
    </>
  );
}

const EVENT_TYPES: EventType[] = ['meeting', 'philanthropy', 'social', 'brotherhood', 'service', 'mandatory', 'recruitment'];

const pad = (n: number) => String(n).padStart(2, '0');
const toDateInput = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const toTimeInput = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function EventFormModal({ base, busy, onClose, onSave, onDelete }: {
  base?: EventRow; busy: boolean; onClose: () => void; onSave: (e: EventRow) => void; onDelete?: () => void;
}) {
  const start = base ? new Date(base.startsAt) : new Date(NOW);
  const [title, setTitle] = useState(base?.title ?? '');
  const [type, setType] = useState<EventType>((base?.type as EventType) ?? 'social');
  const [date, setDate] = useState(toDateInput((base ?? { startsAt: start.toISOString() }).startsAt));
  const [time, setTime] = useState(base ? toTimeInput(base.startsAt) : '19:00');
  const [location, setLocation] = useState(base?.location ?? '');
  const [description, setDescription] = useState(base?.description ?? '');
  const [mandatory, setMandatory] = useState(base?.mandatory ?? false);
  const [points, setPoints] = useState(String(base?.pointsValue ?? 10));

  const canSave = title.trim() !== '' && date !== '' && location.trim() !== '' && !busy;
  const submit = () => {
    if (!canSave) return;
    const startsAt = new Date(`${date}T${time || '19:00'}`).toISOString();
    const endsAt = new Date(new Date(startsAt).getTime() + 90 * 60_000).toISOString();
    onSave({
      id: base?.id ?? `evt-local-${Date.now()}`,
      title: title.trim(), type, startsAt, endsAt,
      location: location.trim(), description: description.trim(),
      mandatory, pointsValue: Number(points) || 0,
      rsvp: base?.rsvp ?? { going: 0, maybe: 0, no: 0 },
    });
  };

  return (
    <Modal title={base ? 'Edit event' : 'Create event'} sub={base?.title ?? 'New chapter event'} onClose={onClose} width={500}
      footer={<>
        {onDelete && (
          <button className="pkp-btn-ghost" style={{ height: 38, padding: '0 14px', fontSize: 13.5, color: 'var(--danger-600, #dc2626)', marginRight: 'auto' }}
            disabled={busy} onClick={() => { if (confirm('Delete this event? This cannot be undone.')) onDelete(); }}>
            Delete
          </button>
        )}
        <button className="pkp-btn-ghost" style={{ height: 38, padding: '0 16px', fontSize: 13.5 }} onClick={onClose}>Cancel</button>
        <button className="pkp-btn-primary" style={{ height: 38, padding: '0 18px', fontSize: 13.5, opacity: canSave ? 1 : 0.5, cursor: canSave ? 'pointer' : 'not-allowed' }} disabled={!canSave} onClick={submit}>
          {busy ? 'Saving…' : base ? 'Save changes' : 'Create event'}
        </button>
      </>}>
      <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Founders Day Formal" />
      <FieldRow>
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value as EventType)}
          options={EVENT_TYPES.map((t) => ({ value: t, label: TYPE_META[t].label }))} />
        <Field label="Points" type="number" min={0} value={points} onChange={(e) => setPoints(e.target.value)} />
      </FieldRow>
      <FieldRow>
        <Field label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Field label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </FieldRow>
      <Field label="Location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Chapter House — Great Room" />
      <TextArea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's happening?" />
      <Checkbox label="Mandatory (attendance recorded)" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
    </Modal>
  );
}

function EventDrawer({ event: e, members, eventRsvps, live, initialCheckin, onClose, onEdit }: {
  event: EventRow; members: MemberRow[]; eventRsvps: Map<string, RsvpState>; live: boolean;
  initialCheckin: Record<string, AttendanceState>; onClose: () => void; onEdit: () => void;
}) {
  const tm = typeMeta(e.type);
  const past = isPast(e);
  const roster = useMemo(() => members.filter((m) => m.status !== 'inactive'), [members]);

  const [present, setPresent] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(Object.entries(initialCheckin).map(([id, s]) => [id, s === 'present'])));
  const toggle = (id: string) => {
    const next = !present[id];
    setPresent((p) => ({ ...p, [id]: next }));
    if (live) setAttendance(e.id, id, next).catch((err: any) => alert(err?.message ?? 'Could not save check-in.'));
  };

  const goingCount = roster.filter((m) => eventRsvps.get(m.membershipId) === 'going').length;
  const presentCount = roster.filter((m) => present[m.membershipId]).length;
  const goingPresent = roster.filter((m) => eventRsvps.get(m.membershipId) === 'going' && present[m.membershipId]).length;
  const showRate = goingCount > 0 ? Math.round((goingPresent / goingCount) * 100) : null;

  const stat = (val: string, label: string, color: string) => (
    <div className="pkp-card" style={{ padding: 14 }}>
      <div className="pkp-mono" style={{ fontSize: 20, fontWeight: 600, color, lineHeight: 1 }}>{val}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 6 }}>{label}</div>
    </div>
  );

  return (
    <>
      <div className="pkp-scrim" onClick={onClose} />
      <div className="pkp-drawer">
        <div style={{ padding: 22, borderBottom: '1px solid var(--cream-300)', display: 'flex', alignItems: 'flex-start', gap: 14, background: 'var(--white)' }}>
          <DateBlock iso={e.startsAt} muted={past} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600, color: 'var(--ink-900)', lineHeight: 1.15 }}>{e.title}</h2>
            <div style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 4 }}>{relativeDay(e.startsAt, NOW)} · {fmtTime(e.startsAt)}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Badge tone={tm.tone}>{tm.label}</Badge>
              {e.mandatory && <Badge tone="danger">Mandatory</Badge>}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--cream-400)', background: 'var(--white)', color: 'var(--ink-500)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {e.description && <div style={{ fontSize: 13, color: 'var(--ink-600)', lineHeight: 1.6 }}>{e.description}</div>}

          <div className="pkp-card" style={{ padding: 16 }}>
            <div className="pkp-col-head" style={{ marginBottom: 11 }}>Details</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[['Location', e.location || '—'], ['Points', `${e.pointsValue} pts`]].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: 'var(--ink-500)' }}>{k}</span>
                  <span style={{ fontSize: 13, color: 'var(--ink-800)', fontWeight: 500 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="pkp-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="pkp-col-head">RSVPs</div>
              <span style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>{roster.length} active brothers</span>
            </div>
            <RsvpBar rsvp={e.rsvp} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginTop: 14 }}>
              {stat(String(e.rsvp.going), 'Going', 'var(--success-600)')}
              {stat(String(e.rsvp.maybe), 'Maybe', 'var(--warning-600)')}
              {stat(String(e.rsvp.no), 'Not going', 'var(--ink-700)')}
            </div>
          </div>

          <div className="pkp-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="pkp-col-head">{past ? 'Check-in' : 'Guest list'}</div>
              <span className="pkp-mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--pkp-primary)' }}>{presentCount} present</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {roster.map((m, i) => {
                const r = eventRsvps.get(m.membershipId) ?? null;
                const on = present[m.membershipId];
                return (
                  <div key={m.membershipId} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: i ? '1px solid var(--cream-200)' : 'none' }}>
                    <Avatar name={m.fullName} size={32} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-800)' }}>{m.fullName}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{r ? RSVP_META[r].label : 'No response'}</div>
                    </div>
                    <button onClick={() => toggle(m.membershipId)} className={on ? 'pkp-btn-primary' : 'pkp-btn-ghost'}
                      style={{ height: 30, padding: '0 13px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {on ? '✓ Present' : 'Check in'}
                    </button>
                  </div>
                );
              })}
            </div>
            {!live && (
              <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 10 }}>
                Check-in is not saved yet — mock mode only.
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: '16px 22px', borderTop: '1px solid var(--cream-300)', background: 'var(--white)', display: 'flex', gap: 10 }}>
          <button className="pkp-btn-ghost" style={{ flex: 1, height: 42, fontSize: 13.5 }} onClick={onEdit}>Edit event</button>
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────── Member view ─────────────────────────── */

function MemberEvents({ events, me, rsvpIndex, live }: {
  events: EventRow[]; me: MemberRow; rsvpIndex: RsvpIndex; live: boolean;
}) {
  const router = useRouter();
  const sorted = useMemo(
    () => [...events].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [events],
  );
  const upcoming = sorted.filter((e) => !isPast(e));
  const past = sorted.filter((e) => isPast(e)).reverse();

  const seed = useMemo(
    () => Object.fromEntries(events.map((e) => [e.id, rsvpIndex.get(e.id)?.get(me.membershipId) ?? null])) as Record<string, RsvpState | null>,
    [events, rsvpIndex, me.membershipId],
  );
  const [rsvps, setRsvps] = useState<Record<string, RsvpState | null>>(seed);
  useEffect(() => setRsvps(seed), [seed]);

  const onRsvp = (id: string, s: RsvpState) => {
    const next = rsvps[id] === s ? null : s;
    setRsvps((prev) => ({ ...prev, [id]: next })); // optimistic
    if (live) setRsvp(id, next).then(() => router.refresh()).catch((err: any) => { alert(err?.message ?? 'RSVP failed'); router.refresh(); });
  };

  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    const focus = sessionStorage.getItem('pkp-focus-event');
    if (!focus) return;
    sessionStorage.removeItem('pkp-focus-event');
    setFlashId(focus);
    document.getElementById(`evt-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setFlashId(null), 1600);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 22 }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 className="pkp-h3">Upcoming</h3>
        {upcoming.length === 0 && <div className="pkp-card" style={{ padding: 20, fontSize: 13.5, color: 'var(--ink-500)' }}>No upcoming events yet.</div>}
        {upcoming.map((e) => {
          const tm = typeMeta(e.type);
          const mine = rsvps[e.id] ?? null;
          return (
            <div key={e.id} id={`evt-${e.id}`} className={`pkp-card${flashId === e.id ? ' pkp-flash' : ''}`} style={{ padding: 16, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <DateBlock iso={e.startsAt} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-900)' }}>{e.title}</span>
                  <Badge tone={tm.tone}>{tm.label}</Badge>
                  {e.mandatory && <Badge tone="danger">Mandatory</Badge>}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginTop: 3 }}>
                  {relativeDay(e.startsAt, NOW)} · {fmtTime(e.startsAt)} · {e.location}
                </div>
                {e.description && <p style={{ fontSize: 13, color: 'var(--ink-600)', lineHeight: 1.55, margin: '10px 0 0' }}>{e.description}</p>}
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  {(['going', 'maybe', 'no'] as RsvpState[]).map((s) => {
                    const on = mine === s;
                    return (
                      <button key={s} onClick={() => onRsvp(e.id, s)} className={on ? 'pkp-btn-primary' : 'pkp-btn-ghost'}
                        style={{ flex: 1, height: 38, fontSize: 13, padding: '0 10px' }}>
                        {RSVP_META[s].label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 className="pkp-h3">Your RSVP history</h3>
        <div className="pkp-card" style={{ overflow: 'hidden' }}>
          {past.length === 0 && <div style={{ padding: 20, fontSize: 13.5, color: 'var(--ink-500)' }}>No past events yet.</div>}
          {past.map((e, i) => {
            const r = rsvpIndex.get(e.id)?.get(me.membershipId) ?? null;
            return (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', borderTop: i ? '1px solid var(--cream-200)' : 'none' }}>
                <DateBlock iso={e.startsAt} muted />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-800)' }}>{e.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 2 }}>{typeMeta(e.type).label} · {e.location}</div>
                </div>
                {r ? <Badge tone={RSVP_META[r].tone}>{RSVP_META[r].label}</Badge> : <Badge tone="neutral">No response</Badge>}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
