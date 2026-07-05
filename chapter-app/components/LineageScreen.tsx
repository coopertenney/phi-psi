'use client';

import { useEffect, useMemo, useState } from 'react';
import type { MemberRow } from '@/lib/types';
import { LineageTree } from './LineageTree';
import { useApp } from './Providers';
import { Modal, ModalActions, Field, Select, TextArea, parseCsv } from './form';

/* Client shell around the full-chapter lineage tree: holds the (session-local)
   roster so exec edits + pledge-class imports show up immediately — the tree is
   presentational and rebuilds its graph from whatever roster it's handed. Writes
   are ephemeral until Supabase is wired, matching every other screen. */

const roleLabelFor = (status: MemberRow['status']) =>
  status === 'new' ? 'New Member' : status === 'inactive' ? 'Alumnus' : 'Brother';

// A fresh member row with lineage fields set; the rest are neutral defaults.
function newMember(idx: number, name: string, big: string | null, classYear: number | null): MemberRow {
  return {
    membershipId: `local-${Date.now()}-${idx}`,
    fullName: name, avatarUrl: null, email: '', phone: '',
    position: null, roleLabel: roleLabelFor('new'), status: 'new',
    classYear, committee: 'Unassigned',
    bigName: big, littleNames: [], points: 0, attendancePct: 100,
    balanceCents: 0, chargedCents: 0, paidCents: 0, duesState: 'paid', flags: [],
  };
}

export function LineageScreen({ members }: { members: MemberRow[] }) {
  const { role } = useApp();
  const isExec = role === 'exec';
  const [roster, setRoster] = useState<MemberRow[]>(members);
  useEffect(() => setRoster(members), [members]); // follow server refreshes
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState(false);

  const importClass = (ms: MemberRow[]) => { setRoster((r) => [...ms, ...r]); setImporting(false); };
  const saveBig = (id: string, name: string, big: string | null) =>
    setRoster((r) => r.map((m) => (m.membershipId === id ? { ...m, fullName: name, bigName: big } : m)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {isExec && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="pkp-btn-ghost" style={{ height: 38, padding: '0 16px', fontSize: 13.5 }} onClick={() => setEditing(true)}>Individual edits</button>
          <button className="pkp-btn-primary" style={{ height: 38, padding: '0 16px', fontSize: 13.5 }} onClick={() => setImporting(true)}>Import new pledge class</button>
        </div>
      )}

      <LineageTree members={roster} interactive />

      {importing && <ImportPledgeClassModal onClose={() => setImporting(false)} onImport={importClass} />}
      {editing && <EditLineageModal roster={roster} onClose={() => setEditing(false)} onSave={saveBig} />}
    </div>
  );
}

/* ─────────────────────────── Import a new pledge class ─────────────────────────── */

const SAMPLE_CSV = 'Name, Big, Class Year\nJordan Lee, Cooper Tenney, 2029\nSam Rivera, Eddy Duran, 2029';

// Parse pasted/uploaded CSV into pledge rows. Columns: Name, Big, [Class Year].
// A header row is optional; without one, columns are assumed in that order.
function parsePledges(text: string): { members: MemberRow[]; skipped: number } {
  const rows = parseCsv(text);
  if (!rows.length) return { members: [], skipped: 0 };

  const idxOf = (aliases: string[], fallback: number) => {
    const i = rows[0].findIndex((c) => aliases.includes(c.toLowerCase().trim()));
    return i === -1 ? fallback : i;
  };
  const first = rows[0].map((c) => c.toLowerCase().trim());
  const hasHeader = first.some((c) => ['name', 'big', 'class year', 'class', 'year'].includes(c));
  const nameCol = idxOf(['name', 'full name', 'brother', 'pledge'], 0);
  const bigCol = idxOf(['big', 'big brother', 'lineage'], 1);
  const yearCol = idxOf(['class year', 'class', 'year', 'grad year'], 2);
  const data = hasHeader ? rows.slice(1) : rows;

  let skipped = 0;
  const members: MemberRow[] = [];
  data.forEach((cells, i) => {
    const name = (cells[nameCol] ?? '').trim();
    if (!name) { skipped++; return; }
    const big = (cells[bigCol] ?? '').trim() || null;
    const cy = (cells[yearCol] ?? '').match(/\d{4}/)?.[0];
    members.push(newMember(i, name, big, cy ? Number(cy) : null));
  });
  return { members, skipped };
}

function ImportPledgeClassModal({ onClose, onImport }: { onClose: () => void; onImport: (m: MemberRow[]) => void }) {
  const [text, setText] = useState('');
  const { members, skipped } = useMemo(() => parsePledges(text), [text]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) file.text().then(setText);
  };

  return (
    <Modal
      title="Import new pledge class"
      sub="Add a pledge class with their bigs — they'll join the tree as new members"
      width={540}
      onClose={onClose}
      footer={<ModalActions onCancel={onClose} onSave={() => onImport(members)} canSave={members.length > 0}
        saveLabel={<>Import {members.length || ''} {members.length === 1 ? 'pledge' : 'pledges'}</>} />}
    >
      <div style={{ fontSize: 13, color: 'var(--ink-600)', lineHeight: 1.5 }}>
        Columns: <strong>Name</strong>, <strong>Big</strong>, Class Year — a header row is optional.
        The Big links each pledge into an existing line; unknown bigs show as alumni anchors.
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-600)' }}>Upload a .csv file</span>
        <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ fontSize: 13, color: 'var(--ink-700)' }} />
      </label>

      <TextArea label="…or paste rows" value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE_CSV} rows={6} />

      {text.trim() !== '' && (
        <div className="pkp-card" style={{ padding: 14 }}>
          {members.length > 0 ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-900)' }}>
                {members.length} {members.length === 1 ? 'pledge' : 'pledges'} ready
                {skipped > 0 && <span style={{ fontWeight: 400, color: 'var(--ink-500)' }}> · {skipped} skipped (no name)</span>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {members.slice(0, 24).map((m) => (
                  <span key={m.membershipId} className="pkp-badge neutral">{m.fullName}{m.bigName ? ` → ${m.bigName}` : ''}</span>
                ))}
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

/* ─────────────────────────── Edit one brother's line ─────────────────────────── */

// Littles are derived by inverting bigs, so lineage edits set the *big* — never
// littles directly. Twin bigs are entered as "Name & Name" (the roster's format).
function EditLineageModal({ roster, onClose, onSave }: {
  roster: MemberRow[]; onClose: () => void; onSave: (id: string, name: string, big: string | null) => void;
}) {
  const sorted = useMemo(() => [...roster].sort((a, b) => a.fullName.localeCompare(b.fullName)), [roster]);
  const [id, setId] = useState(sorted[0]?.membershipId ?? '');
  const selected = sorted.find((m) => m.membershipId === id) ?? null;
  const [name, setName] = useState(selected?.fullName ?? '');
  const [big, setBig] = useState(selected?.bigName ?? '');

  // Re-seed the fields when the picked brother changes.
  const pick = (nextId: string) => {
    setId(nextId);
    const m = sorted.find((x) => x.membershipId === nextId);
    setName(m?.fullName ?? '');
    setBig(m?.bigName ?? '');
  };

  const allNames = useMemo(() => sorted.map((m) => m.fullName), [sorted]);
  const canSave = name.trim() !== '' && !!selected;
  const submit = () => { if (canSave) onSave(id, name.trim(), big.trim() || null); onClose(); };

  return (
    <Modal
      title="Edit lineage"
      sub="Fix a brother's big — his littles update automatically"
      onClose={onClose}
      footer={<ModalActions onCancel={onClose} onSave={submit} canSave={canSave} saveLabel="Save changes" />}
    >
      <Select label="Brother" value={id} onChange={(e) => pick(e.target.value)}
        options={sorted.map((m) => ({ value: m.membershipId, label: m.fullName }))} />
      <Field label="Full name" value={name} onChange={(e) => setName(e.target.value)} placeholder="First Last" />
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-600)' }}>Big (blank = top of a line; use “A &amp; B” for twin bigs)</span>
        <input list="pkp-lineage-names" value={big} onChange={(e) => setBig(e.target.value)} placeholder="Big's name"
          style={{ width: '100%', border: '1px solid var(--cream-400)', borderRadius: 'var(--radius-md)', background: 'var(--white)', padding: '9px 11px', fontSize: 13.5, color: 'var(--ink-800)', fontFamily: 'var(--font-sans)', outline: 'none' }} />
        <datalist id="pkp-lineage-names">
          {allNames.map((n) => <option key={n} value={n} />)}
        </datalist>
      </label>
      {selected && selected.littleNames.length > 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--ink-500)' }}>
          Littles (derived): {selected.littleNames.join(', ')}
        </div>
      )}
    </Modal>
  );
}
