'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EventRow, EventType, MemberRow, RsvpState } from '@/lib/types';
import type { EventRsvp } from '@/lib/data';
import { fmtTime, relativeDay, type BadgeTone } from '@/lib/format';
import { NOW } from '@/lib/engagement';
import { currentMember } from '@/lib/session';
import { createEvent, updateEvent, deleteEvent, setRsvp, type EventInput } from '@/app/socials/actions';
import { useApp } from './Providers';
import { Avatar, Badge, AddButton, MiniStat, Drawer } from './ui';
import { icons } from './icons';
import { Modal, Field, Select, TextArea, FieldRow } from './form';

/* ─────────────────────────── Socials = social + brotherhood ───────────────────────────
   The tab was narrowed from the old all-purpose Events screen to just the social
   calendar (mixers, formals, brotherhood nights). Meetings + attendance live on
   the Attendance tab; philanthropy/service events don't have a home yet (orphaned
   on purpose — see the DEFERRED note in ROADMAP). The view is a week-grouped
   agenda timeline rather than a filtered table. */

const SOCIAL_TYPES: EventType[] = ['social', 'brotherhood'];
const isSocial = (e: EventRow) => SOCIAL_TYPES.includes(e.type);

const TYPE_META: Record<'social' | 'brotherhood', { label: string; tone: BadgeTone }> = {
  social: { label: 'Social', tone: 'info' },
  brotherhood: { label: 'Brotherhood', tone: 'warning' },
};
const typeMeta = (t: string) => TYPE_META[t as 'social' | 'brotherhood'] ?? { label: t, tone: 'neutral' as BadgeTone };

const RSVP_META: Record<RsvpState, { tone: BadgeTone; label: string }> = {
  going: { tone: 'success', label: 'Going' },
  maybe: { tone: 'warning', label: 'Maybe' },
  no: { tone: 'neutral', label: 'Not going' },
};

const DAY = 86_400_000;
const HRS2 = 2 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// An event's end time — falls back to 2h after start when there's no explicit end.
const endMs = (e: EventRow): number => (e.endsAt ? new Date(e.endsAt).getTime() : new Date(e.startsAt).getTime() + HRS2);
// Live = started but not yet ended, relative to the demo clock (NOW).
const isLiveNow = (e: EventRow): boolean => { const n = NOW.getTime(); return new Date(e.startsAt).getTime() <= n && n < endMs(e); };
// Past = already ended, so an in-progress event reads as "live", not "past".
const isPast = (e: EventRow): boolean => endMs(e) <= NOW.getTime();

// Monday 00:00 of the week containing `d`.
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // 0 = Monday
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - dow);
  return x;
}
// Relative week bucket for the agenda headers: This week / Next week / Week of …
function weekBucket(iso: string, now: Date): { order: number; label: string } {
  const base = startOfWeek(now).getTime();
  const wk = startOfWeek(new Date(iso)).getTime();
  const weeks = Math.round((wk - base) / (7 * DAY));
  if (weeks <= 0) return { order: 0, label: 'This week' };
  if (weeks === 1) return { order: 1, label: 'Next week' };
  const d = new Date(wk);
  return { order: weeks, label: `Week of ${MONTHS[d.getMonth()]} ${d.getDate()}` };
}
// Group already-sorted socials into ordered week buckets.
function byWeek(socials: EventRow[], now: Date): { label: string; items: EventRow[] }[] {
  const groups = new Map<number, { label: string; items: EventRow[] }>();
  for (const e of socials) {
    const b = weekBucket(e.startsAt, now);
    if (!groups.has(b.order)) groups.set(b.order, { label: b.label, items: [] });
    groups.get(b.order)!.items.push(e);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
}

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
  location: e.location, description: e.description,
  // Formatted here (client-side) so the creation notification shows the time in
  // the chapter's timezone rather than the server's UTC.
  whenLabel: new Date(e.startsAt).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }),
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

/* ─────────────────────────── Month calendar ───────────────────────────
   A month grid keyed off the demo clock (NOW = today). Days with a social get a
   tinted pill + dot; today is a solid pill. Clicking a day opens its first
   social. Prev/next browse months. */
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
function MonthCalendar({ events, onPickDay }: { events: EventRow[]; onPickDay: (id: string) => void }) {
  const [view, setView] = useState(() => new Date(NOW.getFullYear(), NOW.getMonth(), 1));
  const y = view.getFullYear();
  const mo = view.getMonth();
  const startPad = new Date(y, mo, 1).getDay();          // 0 = Sunday
  const daysIn = new Date(y, mo + 1, 0).getDate();
  const isToday = (d: number) => NOW.getFullYear() === y && NOW.getMonth() === mo && NOW.getDate() === d;

  const byDay = useMemo(() => {
    const m = new Map<number, EventRow[]>();
    for (const e of events) {
      const d = new Date(e.startsAt);
      if (d.getFullYear() === y && d.getMonth() === mo) {
        (m.get(d.getDate()) ?? m.set(d.getDate(), []).get(d.getDate())!).push(e);
      }
    }
    return m;
  }, [events, y, mo]);

  const cells: (number | null)[] = [...Array(startPad).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  const navBtn: React.CSSProperties = { border: '1px solid var(--cream-400)', background: 'var(--white)', borderRadius: 8, width: 28, height: 28, cursor: 'pointer', color: 'var(--ink-600)', fontSize: 15, lineHeight: 1 };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button style={navBtn} aria-label="Previous month" onClick={() => setView(new Date(y, mo - 1, 1))}>‹</button>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink-900)' }}>
          {view.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
        </div>
        <button style={navBtn} aria-label="Next month" onClick={() => setView(new Date(y, mo + 1, 1))}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
        {WEEKDAYS.map((d, i) => (
          <div key={i} style={{ textAlign: 'center', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', color: 'var(--ink-400)', padding: '2px 0' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const evs = byDay.get(d) ?? [];
          const has = evs.length > 0;
          const tod = isToday(d);
          return (
            <button
              key={i} disabled={!has} title={has ? evs.map((e) => e.title).join(', ') : undefined}
              onClick={() => has && onPickDay(evs[0].id)}
              style={{
                height: 42, borderRadius: 12, border: 'none', padding: 0,
                cursor: has ? 'pointer' : 'default',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                background: tod ? 'var(--pkp-primary)' : has ? 'color-mix(in srgb, var(--pkp-primary) 13%, transparent)' : 'transparent',
                color: tod ? '#fff' : has ? 'var(--pkp-primary)' : 'var(--ink-700)',
                fontWeight: tod || has ? 700 : 500, fontSize: 13,
              }}
            >
              <span className="pkp-mono">{d}</span>
              <span style={{ width: 5, height: 5, borderRadius: 999, background: has ? (tod ? '#fff' : 'var(--pkp-primary)') : 'transparent' }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── Live event card ───────────────────────────
   Prominent banner at the top of the member agenda when an event is happening
   right now (started, not yet ended — see isLiveNow). Chapter meetings
   (type 'meeting') get a "Check In Now" button that jumps to the Attendance tab,
   where the rotating room-code check-in lives; any other live event (a social)
   just shows the live styling with no action. */
function LiveEventCard({ event: e, onCheckIn }: { event: EventRow; onCheckIn: () => void }) {
  const isMeeting = e.type === 'meeting';
  return (
    <div style={{
      position: 'relative', borderRadius: 'var(--radius-lg)', padding: 16,
      border: '1px solid var(--success-300)',
      background: 'linear-gradient(180deg, color-mix(in srgb, var(--success-500) 11%, var(--white)), var(--white))',
      boxShadow: '0 0 0 3px color-mix(in srgb, var(--success-500) 12%, transparent)',
    }}>
      <span style={{
        position: 'absolute', top: 13, right: 13, display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: '#fff',
        background: 'var(--success-500)', padding: '3px 10px', borderRadius: 999,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: '#fff' }} /> LIVE
      </span>
      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink-900)', paddingRight: 62, lineHeight: 1.2 }}>{e.title}</div>
      <div style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 4 }}>Now · {e.location || 'Chapter House'}</div>
      {isMeeting && (
        <button onClick={onCheckIn} style={{
          marginTop: 14, width: '100%', height: 46, border: 'none', borderRadius: 999, cursor: 'pointer',
          background: 'var(--success-500)', color: '#fff', fontSize: 14.5, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: '#fff' }} /> Check In Now
        </button>
      )}
    </div>
  );
}

type Props = {
  events: EventRow[];
  members: MemberRow[];
  rsvps: EventRsvp[];
  myMembershipId: string | null;
  live: boolean;
};

export function SocialsScreen({ events, members, rsvps, myMembershipId, live }: Props) {
  const { role, persona } = useApp();
  const rsvpIndex = useMemo(() => buildIndex(rsvps), [rsvps]);
  const socials = useMemo(() => events.filter(isSocial), [events]);

  if (role === 'member') {
    const me = live ? members.find((m) => m.membershipId === myMembershipId) : currentMember(members, persona);
    return me
      ? <MemberSocials socials={socials} events={events} me={me} rsvpIndex={rsvpIndex} live={live} />
      : <p style={{ color: 'var(--ink-500)' }}>Your member profile isn’t loaded yet.</p>;
  }
  return <ExecSocials socials={socials} members={members} rsvpIndex={rsvpIndex} live={live} />;
}

/* ─────────────────────────── Exec: agenda + create/edit ─────────────────────────── */

function ExecSocials({ socials, members, rsvpIndex, live }: {
  socials: EventRow[]; members: MemberRow[]; rsvpIndex: RsvpIndex; live: boolean;
}) {
  const router = useRouter();
  const [list, setList] = useState<EventRow[]>(socials);
  useEffect(() => setList(socials), [socials]); // follow server refreshes
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
  const liveNow = useMemo(() => sorted.filter(isLiveNow), [sorted]);
  // Strictly-future socials, grouped by week (This week / Next week / …).
  const upcoming = useMemo(() => byWeek(sorted.filter((e) => new Date(e.startsAt).getTime() > NOW.getTime()), NOW), [sorted]);
  const past = useMemo(() => sorted.filter(isPast).reverse(), [sorted]);
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
      alert(err?.message ?? 'Could not save the social.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!live) { setList((l) => l.filter((x) => x.id !== id)); setSelectedId(null); setForm(null); return; }
    setBusy(true);
    try { await deleteEvent(id); router.refresh(); setSelectedId(null); setForm(null); }
    catch (err: any) { alert(err?.message ?? 'Could not delete the social.'); }
    finally { setBusy(false); }
  };

  const row = (e: EventRow, { muted = false, live: liveRow = false }: { muted?: boolean; live?: boolean } = {}) => {
    const tm = typeMeta(e.type);
    return (
      <div key={e.id} className="pkp-row" style={{ display: 'flex', gap: 14, alignItems: 'center', gridTemplateColumns: 'unset' }} onClick={() => setSelectedId(e.id)}>
        <DateBlock iso={e.startsAt} muted={muted} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink-900)' }}>{e.title}</span>
            {liveRow && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, letterSpacing: '.03em', color: 'var(--success-600)', background: 'var(--success-100)', padding: '2px 8px', borderRadius: 999 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--success-500)' }} /> LIVE
              </span>
            )}
            <Badge tone={tm.tone}>{tm.label}</Badge>
            {e.mandatory && <Badge tone="danger">Mandatory</Badge>}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginTop: 3 }}>
            {relativeDay(e.startsAt, NOW)} · {fmtTime(e.startsAt)} · {e.location}
          </div>
        </div>
        <div className="pkp-evt-rsvp" style={{ width: 132, flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-600)', marginBottom: 5, textAlign: 'right' }}>
            <span style={{ fontWeight: 600, color: 'var(--ink-800)' }}>{e.rsvp.going}</span> going
          </div>
          <RsvpBar rsvp={e.rsvp} />
        </div>
        <div style={{ display: 'flex', color: 'var(--ink-400)' }}>{icons.chevron}</div>
      </div>
    );
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h3 className="pkp-h3">Socials</h3>
          <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginTop: 2 }}>Mixers, formals & brotherhood nights</div>
        </div>
        <AddButton label="Create social" onClick={() => setForm('new')} />
      </div>

      <div className="pkp-socials-grid">
        <div className="pkp-pa-col">
          {liveNow.length > 0 && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="pkp-col-head" style={{ color: 'var(--success-600)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--success-500)' }} /> Live now
              </div>
              <div className="pkp-card" style={{ overflow: 'hidden', border: '1px solid var(--success-300)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--success-500) 12%, transparent)' }}>
                {liveNow.map((e, i) => (
                  <div key={e.id} style={{ borderTop: i ? '1px solid var(--cream-200)' : 'none', background: 'color-mix(in srgb, var(--success-500) 6%, transparent)' }}>{row(e, { live: true })}</div>
                ))}
              </div>
            </section>
          )}

          {liveNow.length === 0 && upcoming.length === 0 && (
            <div className="pkp-card" style={{ padding: 32, textAlign: 'center', fontSize: 13.5, color: 'var(--ink-500)' }}>
              No upcoming socials. Click “Create social” to add one.
            </div>
          )}
          {upcoming.map((g) => (
            <section key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="pkp-col-head">{g.label}</div>
              <div className="pkp-card" style={{ overflow: 'hidden' }}>
                {g.items.map((e, i) => (
                  <div key={e.id} style={{ borderTop: i ? '1px solid var(--cream-200)' : 'none' }}>{row(e)}</div>
                ))}
              </div>
            </section>
          ))}

          {past.length > 0 && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="pkp-col-head">Past</div>
              <div className="pkp-card" style={{ overflow: 'hidden' }}>
                {past.map((e, i) => (
                  <div key={e.id} style={{ borderTop: i ? '1px solid var(--cream-200)' : 'none' }}>{row(e, { muted: true })}</div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="pkp-socials-cal">
          <div className="pkp-card" style={{ padding: 16, position: 'sticky', top: 16 }}>
            <MonthCalendar events={list} onPickDay={(id) => setSelectedId(id)} />
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--ink-500)' }}>
              <span style={{ width: 9, height: 9, borderRadius: 999, background: 'color-mix(in srgb, var(--pkp-primary) 30%, transparent)' }} /> Days with a social · tap to open
            </div>
          </div>
        </div>
      </div>

      {selected && (
        <SocialDrawer
          event={selected}
          members={members}
          eventRsvps={rsvpIndex.get(selected.id) ?? new Map()}
          onClose={() => setSelectedId(null)}
          onEdit={() => setForm(selected)}
        />
      )}
      {form && (
        <SocialFormModal
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

const pad = (n: number) => String(n).padStart(2, '0');
const toDateInput = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const toTimeInput = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function SocialFormModal({ base, busy, onClose, onSave, onDelete }: {
  base?: EventRow; busy: boolean; onClose: () => void; onSave: (e: EventRow) => void; onDelete?: () => void;
}) {
  const start = base ? new Date(base.startsAt) : new Date(NOW);
  const [title, setTitle] = useState(base?.title ?? '');
  // Socials tab only creates social/brotherhood events (see SOCIAL_TYPES).
  const [type, setType] = useState<EventType>(base && isSocial(base) ? base.type : 'social');
  const [date, setDate] = useState(toDateInput((base ?? { startsAt: start.toISOString() }).startsAt));
  const [time, setTime] = useState(base ? toTimeInput(base.startsAt) : '21:00');
  const [location, setLocation] = useState(base?.location ?? '');
  const [description, setDescription] = useState(base?.description ?? '');

  const canSave = title.trim() !== '' && date !== '' && location.trim() !== '' && !busy;
  const submit = () => {
    if (!canSave) return;
    const startsAt = new Date(`${date}T${time || '21:00'}`).toISOString();
    const endsAt = new Date(new Date(startsAt).getTime() + 120 * 60_000).toISOString();
    onSave({
      id: base?.id ?? `evt-local-${Date.now()}`,
      title: title.trim(), type, startsAt, endsAt,
      location: location.trim(), description: description.trim(),
      // Socials aren't mandatory and don't carry points — keep any existing
      // values on edit, default to none for new ones.
      mandatory: base?.mandatory ?? false, pointsValue: base?.pointsValue ?? 0,
      rsvp: base?.rsvp ?? { going: 0, maybe: 0, no: 0 },
    });
  };

  return (
    <Modal title={base ? 'Edit social' : 'Create social'} sub={base?.title ?? 'New social event'} onClose={onClose} width={500}
      footer={<>
        {onDelete && (
          <button className="pkp-btn-ghost" style={{ height: 38, padding: '0 14px', fontSize: 13.5, color: 'var(--danger-600, #dc2626)', marginRight: 'auto' }}
            disabled={busy} onClick={() => { if (confirm('Delete this social? This cannot be undone.')) onDelete(); }}>
            Delete
          </button>
        )}
        <button className="pkp-btn-ghost" style={{ height: 38, padding: '0 16px', fontSize: 13.5 }} onClick={onClose}>Cancel</button>
        <button className="pkp-btn-primary" style={{ height: 38, padding: '0 18px', fontSize: 13.5, opacity: canSave ? 1 : 0.5, cursor: canSave ? 'pointer' : 'not-allowed' }} disabled={!canSave} onClick={submit}>
          {busy ? 'Saving…' : base ? 'Save changes' : 'Create social'}
        </button>
      </>}>
      <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Founders Day Formal" />
      <Select label="Type" value={type} onChange={(e) => setType(e.target.value as EventType)}
        options={SOCIAL_TYPES.map((t) => ({ value: t, label: TYPE_META[t as 'social' | 'brotherhood'].label }))} />
      <FieldRow>
        <Field label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Field label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </FieldRow>
      <Field label="Location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Chapter House — Great Room" />
      <TextArea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's happening?" />
    </Modal>
  );
}

function SocialDrawer({ event: e, members, eventRsvps, onClose, onEdit }: {
  event: EventRow; members: MemberRow[]; eventRsvps: Map<string, RsvpState>; onClose: () => void; onEdit: () => void;
}) {
  const tm = typeMeta(e.type);
  const past = isPast(e);
  const roster = useMemo(() => members.filter((m) => m.status !== 'inactive'), [members]);
  // Guest list = who RSVP'd, going first. (Attendance check-in is deferred — it
  // moves to the Attendance tab; this drawer is RSVP-only.)
  const ORDER: Record<string, number> = { going: 0, maybe: 1, no: 2, none: 3 };
  const guests = useMemo(
    () => [...roster].sort((a, b) =>
      ORDER[eventRsvps.get(a.membershipId) ?? 'none'] - ORDER[eventRsvps.get(b.membershipId) ?? 'none']),
    [roster, eventRsvps],
  );

  const stat = (val: string, label: string, color: string) => (
    <MiniStat val={val} label={label} color={color} />
  );

  return (
    <Drawer
      onClose={onClose}
      headerGap={14}
      header={<>
        <DateBlock iso={e.startsAt} muted={past} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600, color: 'var(--ink-900)', lineHeight: 1.15 }}>{e.title}</h2>
          <div style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 4 }}>{relativeDay(e.startsAt, NOW)} · {fmtTime(e.startsAt)}</div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Badge tone={tm.tone}>{tm.label}</Badge>
            {e.mandatory && <Badge tone="danger">Mandatory</Badge>}
          </div>
        </div>
      </>}
      footer={<button className="pkp-btn-ghost" style={{ flex: 1, height: 42, fontSize: 13.5 }} onClick={onEdit}>Edit social</button>}
    >
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
            <div className="pkp-col-head" style={{ marginBottom: 12 }}>Guest list</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {guests.map((m, i) => {
                const r = eventRsvps.get(m.membershipId) ?? null;
                return (
                  <div key={m.membershipId} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: i ? '1px solid var(--cream-200)' : 'none' }}>
                    <Avatar name={m.fullName} size={32} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-800)' }}>{m.fullName}</div>
                    </div>
                    {r ? <Badge tone={RSVP_META[r].tone}>{RSVP_META[r].label}</Badge> : <Badge tone="neutral">No response</Badge>}
                  </div>
                );
              })}
            </div>
          </div>
    </Drawer>
  );
}

/* ─────────────────────────── Member: agenda + RSVP ─────────────────────────── */

function MemberSocials({ socials, events, me, rsvpIndex, live }: {
  socials: EventRow[]; events: EventRow[]; me: MemberRow; rsvpIndex: RsvpIndex; live: boolean;
}) {
  const router = useRouter();
  const sorted = useMemo(
    () => [...socials].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [socials],
  );
  const upcoming = useMemo(() => byWeek(sorted.filter((e) => !isPast(e)), NOW), [sorted]);
  const past = useMemo(() => sorted.filter(isPast).reverse(), [sorted]);

  // What's happening right now, across ALL events (not just socials) so a live
  // chapter meeting surfaces here too. Prefer a live meeting (it carries the
  // check-in action); otherwise show the first live event.
  const liveEvent = useMemo(() => {
    const now = events.filter(isLiveNow);
    return now.find((e) => e.type === 'meeting') ?? now[0] ?? null;
  }, [events]);

  const seed = useMemo(
    () => Object.fromEntries(socials.map((e) => [e.id, rsvpIndex.get(e.id)?.get(me.membershipId) ?? null])) as Record<string, RsvpState | null>,
    [socials, rsvpIndex, me.membershipId],
  );
  const [rsvps, setRsvps] = useState<Record<string, RsvpState | null>>(seed);
  useEffect(() => setRsvps(seed), [seed]);

  const onRsvp = (id: string, s: RsvpState) => {
    const next = rsvps[id] === s ? null : s;
    setRsvps((prev) => ({ ...prev, [id]: next })); // optimistic
    if (live) setRsvp(id, next).then(() => router.refresh()).catch((err: any) => { alert(err?.message ?? 'RSVP failed'); router.refresh(); });
  };

  const [flashId, setFlashId] = useState<string | null>(null);
  // Scroll an agenda card into view and flash it. Used by the topbar search
  // hand-off (sessionStorage) and by tapping a day in the calendar.
  const focusEvent = (id: string) => {
    setFlashId(id);
    document.getElementById(`evt-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => setFlashId(null), 1600);
  };
  useEffect(() => {
    const focus = sessionStorage.getItem('pkp-focus-event');
    if (!focus) return;
    sessionStorage.removeItem('pkp-focus-event');
    focusEvent(focus);
  }, []);

  return (
    <div className="pkp-socials-grid">
      <div className="pkp-pa-col">
      {liveEvent && <LiveEventCard event={liveEvent} onCheckIn={() => router.push('/points')} />}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 className="pkp-h3">Upcoming socials</h3>
        {upcoming.length === 0 && <div className="pkp-card" style={{ padding: 20, fontSize: 13.5, color: 'var(--ink-500)' }}>No upcoming socials yet.</div>}
        {upcoming.map((g) => (
          <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="pkp-col-head">{g.label}</div>
            {g.items.map((e) => {
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
          </div>
        ))}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 className="pkp-h3">Your RSVP history</h3>
        <div className="pkp-card" style={{ overflow: 'hidden' }}>
          {past.length === 0 && <div style={{ padding: 20, fontSize: 13.5, color: 'var(--ink-500)' }}>No past socials yet.</div>}
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

      <div className="pkp-socials-cal">
        <div className="pkp-card" style={{ padding: 16, position: 'sticky', top: 16 }}>
          <MonthCalendar events={socials} onPickDay={focusEvent} />
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--ink-500)' }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: 'color-mix(in srgb, var(--pkp-primary) 30%, transparent)' }} /> Days with a social · tap to open
          </div>
        </div>
      </div>
    </div>
  );
}
