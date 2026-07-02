'use client';

import { useEffect, useMemo, useState } from 'react';
import type { MemberRow, MemberStatus, FlagSeverity } from '@/lib/types';
import { money, statusBadge, duesBadge, type BadgeTone } from '@/lib/format';
import { Avatar, Badge } from './ui';
import { icons } from './icons';
import { Modal, Field, Select, FieldRow, TextArea, parseCsv, downloadCsv } from './form';
import { useApp } from './Providers';
import { NOW } from '@/lib/engagement';
import { graduatingClassYear, upcomingAcademicYear } from '@/lib/calendar';

const CHIPS = [
  { id: 'all', label: 'All members' },
  { id: 'active', label: 'Active' },
  { id: 'new', label: 'New members' },
  { id: 'officers', label: 'Officers' },
  { id: 'flagged', label: 'Flagged' },
] as const;
type Filter = (typeof CHIPS)[number]['id'];

function applyFilter(members: MemberRow[], f: Filter): MemberRow[] {
  if (f === 'active') return members.filter((m) => m.status === 'active');
  if (f === 'new') return members.filter((m) => m.status === 'new');
  if (f === 'officers') return members.filter((m) => m.position !== null);
  if (f === 'flagged') return members.filter((m) => m.flags.length > 0);
  return members;
}

const FLAG_TONE: Record<FlagSeverity, BadgeTone> = { danger: 'danger', warning: 'warning', info: 'info' };
const FLAG_COLOR: Record<FlagSeverity, string> = { danger: 'var(--pkp-primary)', warning: 'var(--warning-500)', info: 'var(--info-500)' };
// Highest-severity flag on a member, for the row indicator dot.
const topFlag = (m: MemberRow): FlagSeverity | null =>
  m.flags.some((f) => f.severity === 'danger') ? 'danger'
  : m.flags.some((f) => f.severity === 'warning') ? 'warning'
  : m.flags.length ? 'info' : null;

const roleLabelFor = (position: string | null, status: MemberStatus): string =>
  position || (status === 'new' ? 'New Member' : 'Brother');

export function MembersScreen({ members }: { members: MemberRow[] }) {
  const { isAdmin } = useApp();
  const [roster, setRoster] = useState<MemberRow[]>(members);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rollingOver, setRollingOver] = useState(false);
  const [editing, setEditing] = useState<MemberRow | null>(null);

  // Honor a member focus requested from the topbar search (set in sessionStorage).
  useEffect(() => {
    const focus = sessionStorage.getItem('pkp-focus-member');
    if (focus) { setSelectedId(focus); sessionStorage.removeItem('pkp-focus-member'); }
  }, []);

  const rows = applyFilter(roster, filter);
  const selected = useMemo(() => roster.find((m) => m.membershipId === selectedId) ?? null, [roster, selectedId]);

  const addMember = (m: MemberRow) => { setRoster((r) => [m, ...r]); setAdding(false); };
  const saveEdit = (m: MemberRow) => { setRoster((r) => r.map((x) => (x.membershipId === m.membershipId ? m : x))); setEditing(null); };
  const importClass = (ms: MemberRow[]) => { setRoster((r) => [...ms, ...r]); setImporting(false); setFilter('new'); };
  const startNewYear = () => { setRoster((r) => rolloverRoster(r)); setRollingOver(false); setFilter('active'); };

  const exportCsv = () =>
    downloadCsv(
      'cal-beta-roster.csv',
      ['Name', 'Role', 'Status', 'Class Year', 'Committee', 'Email', 'Phone', 'Points', 'Attendance %', 'Balance', 'Dues'],
      roster.map((m) => [m.fullName, m.roleLabel, m.status, m.classYear ?? '', m.committee ?? '', m.email, m.phone, m.points, m.attendancePct, (m.balanceCents / 100).toFixed(2), m.duesState]),
    );

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div className="pkp-chips">
          {CHIPS.map((c) => (
            <button key={c.id} className={`pkp-chip${filter === c.id ? ' on' : ''}`} onClick={() => setFilter(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {isAdmin && <button className="pkp-btn-ghost" style={{ height: 40, padding: '0 16px', fontSize: 13.5 }} onClick={() => setRollingOver(true)}>Start new year</button>}
          <button className="pkp-btn-ghost" style={{ height: 40, padding: '0 16px', fontSize: 13.5 }} onClick={() => setImporting(true)}>Import class</button>
          <button className="pkp-btn-ghost" style={{ height: 40, padding: '0 16px', fontSize: 13.5 }} onClick={exportCsv}>Export</button>
          <button className="pkp-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 18px', fontSize: 13.5, boxShadow: 'var(--shadow-sm)' }} onClick={() => setAdding(true)}>
            <span style={{ display: 'inline-flex' }}>{icons.plus}</span>Add member
          </button>
        </div>
      </div>

      <div className="pkp-card" style={{ overflow: 'hidden' }}>
        <div className="pkp-table-head">
          <div className="pkp-col-head">Brother</div>
          <div className="pkp-col-head">Role</div>
          <div className="pkp-col-head">Status</div>
          <div className="pkp-col-head pkp-r">Points</div>
          <div className="pkp-col-head pkp-r">Attend.</div>
          <div />
        </div>
        {rows.map((m) => {
          const sb = statusBadge(m.status);
          return (
            <div key={m.membershipId} className="pkp-row" onClick={() => setSelectedId(m.membershipId)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <Avatar name={m.fullName} size={36} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-900)' }}>{m.fullName}</span>
                    {topFlag(m) && (
                      <span title={`${m.flags.length} flag${m.flags.length > 1 ? 's' : ''}`}
                        style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: FLAG_COLOR[topFlag(m)!] }} />
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>Class of {m.classYear} · {m.committee}</div>
                </div>
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--ink-700)' }}>{m.roleLabel}</div>
              <div><Badge tone={sb.tone}>{sb.label}</Badge></div>
              <div className="pkp-mono pkp-r" style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-800)' }}>{m.points}</div>
              <div className="pkp-mono pkp-r" style={{ fontSize: 14, color: 'var(--ink-700)' }}>{m.attendancePct}%</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', color: 'var(--ink-400)' }}>{icons.chevron}</div>
            </div>
          );
        })}
      </div>

      {selected && <MemberDrawer member={selected} onClose={() => setSelectedId(null)} onEdit={() => setEditing(selected)} />}
      {adding && <MemberFormModal onClose={() => setAdding(false)} onSave={addMember} />}
      {importing && <ImportClassModal onClose={() => setImporting(false)} onImport={importClass} />}
      {rollingOver && <NewYearModal roster={roster} onClose={() => setRollingOver(false)} onConfirm={startNewYear} />}
      {editing && <MemberFormModal base={editing} onClose={() => setEditing(null)} onSave={saveEdit} />}
    </>
  );
}

function MemberDrawer({ member: m, onClose, onEdit }: { member: MemberRow; onClose: () => void; onEdit: () => void }) {
  const sb = statusBadge(m.status);
  const db = duesBadge(m.duesState);
  const activity = [
    { text: `Earned ${m.points > 300 ? 15 : 10} points at Chapter Meeting`, time: '2 days ago', color: 'var(--hunter-500)' },
    { text: m.duesState === 'paid' ? 'Paid spring term dues in full' : 'Dues reminder sent', time: '1 week ago', color: m.duesState === 'paid' ? 'var(--success-500)' : 'var(--warning-500)' },
    { text: "RSVP'd to Founders Day Formal", time: '1 week ago', color: 'var(--info-500)' },
  ];
  const detail = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 13, color: 'var(--ink-500)' }}>{label}</span>{value}
    </div>
  );

  return (
    <>
      <div className="pkp-scrim" onClick={onClose} />
      <div className="pkp-drawer">
        <div style={{ padding: 22, borderBottom: '1px solid var(--cream-300)', display: 'flex', alignItems: 'flex-start', gap: 16, background: 'var(--white)' }}>
          <Avatar name={m.fullName} size={58} fontSize={20} />
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 21, fontWeight: 600, color: 'var(--ink-900)' }}>{m.fullName}</h2>
            <div style={{ fontSize: 13.5, color: 'var(--ink-500)', marginTop: 3 }}>{m.roleLabel} · Class of {m.classYear}</div>
            <div style={{ marginTop: 8 }}><Badge tone={sb.tone}>{sb.label}</Badge></div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--cream-400)', background: 'var(--white)', color: 'var(--ink-500)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="pkp-card" style={{ padding: 14 }}>
              <div className="pkp-mono" style={{ fontSize: 22, fontWeight: 600, color: 'var(--pkp-accent)', lineHeight: 1 }}>{m.points}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 6 }}>Points</div>
            </div>
            <div className="pkp-card" style={{ padding: 14 }}>
              <div className="pkp-mono" style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink-900)', lineHeight: 1 }}>{m.attendancePct}%</div>
              <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 6 }}>Attendance</div>
            </div>
          </div>

          {m.flags.length > 0 && (
            <div className="pkp-card" style={{ padding: 16 }}>
              <div className="pkp-col-head" style={{ marginBottom: 12 }}>Accountability flags</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {m.flags.map((f) => (
                  <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--ink-800)', fontWeight: 500 }}>{f.label}</div>
                      {f.note && <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 2 }}>{f.note}</div>}
                    </div>
                    <Badge tone={FLAG_TONE[f.severity]}>{f.severity === 'danger' ? 'Action needed' : f.severity === 'warning' ? 'Watch' : 'Note'}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pkp-card" style={{ padding: 16 }}>
            <div className="pkp-col-head" style={{ marginBottom: 12 }}>Details</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {detail('Committee', <span style={{ fontSize: 13, color: 'var(--ink-800)', fontWeight: 500 }}>{m.committee}</span>)}
              {detail('Dues', <Badge tone={db.tone}>{db.label}</Badge>)}
              {detail('Balance', <span className="pkp-mono" style={{ fontSize: 13, color: 'var(--ink-800)', fontWeight: 600 }}>{money(m.balanceCents)}</span>)}
              {detail('Email', <span style={{ fontSize: 13, color: 'var(--ink-800)' }}>{m.email}</span>)}
              {detail('Phone', <span style={{ fontSize: 13, color: 'var(--ink-800)' }}>{m.phone || '—'}</span>)}
            </div>
          </div>

          <div className="pkp-card" style={{ padding: 16 }}>
            <div className="pkp-col-head" style={{ marginBottom: 12 }}>Lineage</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {detail('Big', <span style={{ fontSize: 13, color: 'var(--ink-800)', fontWeight: 500 }}>{m.bigName ?? '—'}</span>)}
              {detail('Littles', <span style={{ fontSize: 13, color: 'var(--ink-800)', fontWeight: 500, textAlign: 'right' }}>{m.littleNames.length ? m.littleNames.join(', ') : '—'}</span>)}
            </div>
          </div>

          <div className="pkp-card" style={{ padding: 16 }}>
            <div className="pkp-col-head" style={{ marginBottom: 12 }}>Recent activity</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {activity.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 11, padding: '9px 0', borderTop: '1px solid var(--cream-200)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: a.color }} />
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--ink-800)' }}>{a.text}</div>
                    <div className="pkp-mono" style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 2 }}>{a.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 22px', borderTop: '1px solid var(--cream-300)', background: 'var(--white)', display: 'flex', gap: 10 }}>
          <a className="pkp-btn-primary" href={`mailto:${m.email}`} style={{ flex: 1, height: 42, fontSize: 13.5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Message</a>
          <button className="pkp-btn-ghost" style={{ flex: 1, height: 42, fontSize: 13.5 }} onClick={onEdit}>Edit profile</button>
        </div>
      </div>
    </>
  );
}

/* Shared Add/Edit member form. With `base` it edits in place; without, it adds. */
function MemberFormModal({ base, onClose, onSave }: { base?: MemberRow; onClose: () => void; onSave: (m: MemberRow) => void }) {
  const [fullName, setFullName] = useState(base?.fullName ?? '');
  const [email, setEmail] = useState(base?.email ?? '');
  const [phone, setPhone] = useState(base?.phone ?? '');
  const [position, setPosition] = useState(base?.position ?? '');
  const [committee, setCommittee] = useState(base?.committee ?? '');
  const [classYear, setClassYear] = useState(String(base?.classYear ?? new Date().getFullYear() + 3));
  const [status, setStatus] = useState<MemberStatus>(base?.status ?? 'new');

  const canSave = fullName.trim() !== '' && email.trim() !== '';
  const submit = () => {
    if (!canSave) return;
    const pos = position.trim() || null;
    const built: MemberRow = base
      ? { ...base, fullName: fullName.trim(), email: email.trim(), phone: phone.trim(), position: pos, committee: committee.trim() || base.committee, classYear: Number(classYear) || base.classYear, status, roleLabel: roleLabelFor(pos, status) }
      : {
          membershipId: `local-${Date.now()}`, fullName: fullName.trim(), email: email.trim(), phone: phone.trim(),
          position: pos, roleLabel: roleLabelFor(pos, status), status, classYear: Number(classYear) || null,
          committee: committee.trim() || 'Unassigned', bigName: null, littleNames: [], points: 0,
          attendancePct: 100, balanceCents: 0, duesState: 'paid', flags: [],
        };
    onSave(built);
  };

  return (
    <Modal
      title={base ? 'Edit profile' : 'Add member'}
      sub={base ? base.fullName : 'New brother or new member'}
      onClose={onClose}
      footer={<>
        <button className="pkp-btn-ghost" style={{ height: 38, padding: '0 16px', fontSize: 13.5 }} onClick={onClose}>Cancel</button>
        <button className="pkp-btn-primary" style={{ height: 38, padding: '0 18px', fontSize: 13.5, opacity: canSave ? 1 : 0.5, cursor: canSave ? 'pointer' : 'not-allowed' }} disabled={!canSave} onClick={submit}>
          {base ? 'Save changes' : 'Add member'}
        </button>
      </>}
    >
      <Field label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="First Last" />
      <FieldRow>
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@stanford.edu" />
        <Field label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(650) 555-0000" />
      </FieldRow>
      <FieldRow>
        <Field label="Position (blank = none)" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. Treasurer" />
        <Field label="Committee" value={committee} onChange={(e) => setCommittee(e.target.value)} placeholder="e.g. Social" />
      </FieldRow>
      <FieldRow>
        <Field label="Class year" type="number" value={classYear} onChange={(e) => setClassYear(e.target.value)} />
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as MemberStatus)}
          options={[{ value: 'active', label: 'Active' }, { value: 'new', label: 'New Member' }, { value: 'inactive', label: 'Inactive' }]} />
      </FieldRow>
    </Modal>
  );
}

/* ─────────────────────────── Import a new member class via CSV ─────────────────────────── */

type ImportFields = { name: string; email: string; phone: string; classYear: string; committee: string; position: string };

// Maps a CSV header cell to a member field. Unknown headers are ignored.
const HEADER_ALIASES: Record<string, keyof ImportFields> = {
  'name': 'name', 'full name': 'name', 'fullname': 'name', 'member': 'name', 'brother': 'name',
  'email': 'email', 'e-mail': 'email', 'email address': 'email',
  'phone': 'phone', 'phone number': 'phone', 'mobile': 'phone', 'cell': 'phone',
  'class year': 'classYear', 'class': 'classYear', 'year': 'classYear', 'grad year': 'classYear', 'graduation': 'classYear',
  'committee': 'committee', 'team': 'committee',
  'position': 'position', 'role': 'position', 'office': 'position', 'title': 'position',
};
// Column order assumed when the CSV has no recognizable header row.
const DEFAULT_ORDER: (keyof ImportFields)[] = ['name', 'email', 'phone', 'classYear', 'committee'];

// Parse pasted/uploaded CSV into new-member rows. Rows without a name are skipped.
function parseClass(text: string): { members: MemberRow[]; skipped: number } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { members: [], skipped: 0 };

  const firstLower = rows[0].map((c) => c.toLowerCase());
  const hasHeader = firstLower.some((c) => c in HEADER_ALIASES);
  const colMap = new Map<number, keyof ImportFields>();
  if (hasHeader) firstLower.forEach((c, i) => { const f = HEADER_ALIASES[c]; if (f) colMap.set(i, f); });
  else DEFAULT_ORDER.forEach((f, i) => colMap.set(i, f));
  const dataRows = hasHeader ? rows.slice(1) : rows;

  let skipped = 0;
  const members: MemberRow[] = [];
  dataRows.forEach((cells, idx) => {
    const f: ImportFields = { name: '', email: '', phone: '', classYear: '', committee: '', position: '' };
    colMap.forEach((field, i) => { f[field] = cells[i] ?? ''; });
    if (!f.name.trim()) { skipped++; return; }
    const cy = f.classYear.match(/\d{4}/)?.[0];
    const pos = f.position.trim() || null;
    members.push({
      membershipId: `local-${Date.now()}-${idx}`,
      fullName: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(),
      position: pos, roleLabel: roleLabelFor(pos, 'new'), status: 'new',
      classYear: cy ? Number(cy) : null, committee: f.committee.trim() || 'Unassigned',
      bigName: null, littleNames: [], points: 0, attendancePct: 100,
      balanceCents: 0, duesState: 'paid', flags: [],
    });
  });
  return { members, skipped };
}

const SAMPLE_CSV = 'Name, Email, Phone, Class Year, Committee\nJordan Lee, jlee@stanford.edu, (650) 555-0192, 2028, Service';

function ImportClassModal({ onClose, onImport }: { onClose: () => void; onImport: (m: MemberRow[]) => void }) {
  const [text, setText] = useState('');
  const { members, skipped } = useMemo(() => parseClass(text), [text]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) file.text().then(setText);
  };

  return (
    <Modal
      title="Import a class"
      sub="Add a new-member class from a CSV"
      width={540}
      onClose={onClose}
      footer={<>
        <button className="pkp-btn-ghost" style={{ height: 38, padding: '0 16px', fontSize: 13.5 }} onClick={onClose}>Cancel</button>
        <button className="pkp-btn-primary" style={{ height: 38, padding: '0 18px', fontSize: 13.5, opacity: members.length ? 1 : 0.5, cursor: members.length ? 'pointer' : 'not-allowed' }}
          disabled={members.length === 0} onClick={() => onImport(members)}>
          Import {members.length || ''} {members.length === 1 ? 'member' : 'members'}
        </button>
      </>}
    >
      <div style={{ fontSize: 13, color: 'var(--ink-600)', lineHeight: 1.5 }}>
        Columns: <strong>Name</strong>, Email, Phone, Class Year, Committee — a header row is optional.
        Everyone is added as a <strong>New member</strong>.
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-600)' }}>Upload a .csv file</span>
        <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ fontSize: 13, color: 'var(--ink-700)' }} />
      </label>

      <TextArea label="…or paste CSV rows" value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE_CSV} rows={6} />

      {text.trim() !== '' && (
        <div className="pkp-card" style={{ padding: 14 }}>
          {members.length > 0 ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>
                {members.length} {members.length === 1 ? 'member' : 'members'} ready
                {skipped > 0 && <span style={{ fontWeight: 400, color: 'var(--ink-500)' }}> · {skipped} skipped (no name)</span>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {members.slice(0, 24).map((m) => <span key={m.membershipId} className="pkp-badge neutral">{m.fullName}</span>)}
                {members.length > 24 && <span className="pkp-badge neutral">+{members.length - 24} more</span>}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--ink-500)' }}>No rows with a name found yet.</div>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ─────────────────────────── New school year: roster rollover ─────────────────────────── */

// The class graduating this academic year (spring grads) leaves the active roster.
const GRAD_YEAR = graduatingClassYear(NOW);

// Roll the roster into the next academic year: new members become active brothers,
// the graduating class moves to alumni, and last year's flags are cleared.
function rolloverRoster(roster: MemberRow[]): MemberRow[] {
  return roster.map((m) => {
    if (m.classYear != null && m.classYear <= GRAD_YEAR)
      return { ...m, status: 'inactive', position: null, roleLabel: 'Alumnus', flags: [] };
    if (m.status === 'new')
      return { ...m, status: 'active', roleLabel: roleLabelFor(m.position, 'active'), flags: [] };
    return { ...m, flags: [] };
  });
}

function NewYearModal({ roster, onClose, onConfirm }: { roster: MemberRow[]; onClose: () => void; onConfirm: () => void }) {
  const next = upcomingAcademicYear(NOW);
  const rows = [
    { n: roster.filter((m) => m.status === 'new').length, label: 'New members → active brothers' },
    { n: roster.filter((m) => m.classYear != null && m.classYear <= GRAD_YEAR).length, label: `Class of ${GRAD_YEAR} → alumni` },
    { n: roster.filter((m) => m.flags.length > 0).length, label: 'Members with flags cleared' },
  ];

  return (
    <Modal
      title="Start a new school year"
      sub={`Roll the chapter into ${next.label}`}
      width={460}
      onClose={onClose}
      footer={<>
        <button className="pkp-btn-ghost" style={{ height: 38, padding: '0 16px', fontSize: 13.5 }} onClick={onClose}>Cancel</button>
        <button className="pkp-btn-primary" style={{ height: 38, padding: '0 18px', fontSize: 13.5 }} onClick={onConfirm}>Roll into {next.label}</button>
      </>}
    >
      <div style={{ fontSize: 13, color: 'var(--ink-600)', lineHeight: 1.5 }}>
        Advances the chapter into the <strong>{next.label}</strong> year. New members become active
        brothers, the graduating class moves to alumni, and last year&apos;s accountability flags are cleared.
      </div>
      <div className="pkp-card" style={{ padding: '6px 16px' }}>
        {rows.map((r, i) => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '11px 0', borderTop: i ? '1px solid var(--cream-200)' : 'none' }}>
            <span style={{ fontSize: 13.5, color: 'var(--ink-700)' }}>{r.label}</span>
            <span className="pkp-mono" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-900)' }}>{r.n}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
