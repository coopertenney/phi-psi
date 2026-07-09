'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MemberRow, PointEntry, PointItem, PointKind, AttendanceState } from '@/lib/types';
import { relativeDay } from '@/lib/format';
import { NOW } from '@/lib/engagement';
import { entriesFor, weekChange, rewardPunishmentSplit, memberPointTotal, pendingFor, POINT_FLOOR } from '@/lib/points';
import type { ScoreConfig } from '@/lib/points';
import { currentMember, MOCK_USER } from '@/lib/session';
import { logPoints, updatePointItem, createPointItem, archivePointItem, reorderPointItems, updatePointsConfig, requestPoints, approvePointEntry, rejectPointEntry, withdrawPointRequest } from '@/app/points/actions';
import type { PointItemPatch, PointsConfigPatch } from '@/app/points/actions';
import type { ChapterSettings } from '@/lib/data';
import { useApp } from './Providers';
import { Badge, Drawer } from './ui';
import { MemberAvatar } from './MemberAvatar';
import { icons } from './icons';
import { Modal, ModalActions, Field, Select } from './form';

const ptColor = (n: number) => (n > 0 ? 'var(--success-600)' : n < 0 ? 'var(--pkp-primary)' : 'var(--ink-500)');
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

type Props = { members: MemberRow[]; entries: PointEntry[]; items: PointItem[]; settings: ChapterSettings; live?: boolean; myMembershipId?: string | null };

export function PointsScreen({ live = false, myMembershipId = null, ...props }: Props) {
  const { role, persona } = useApp();
  const router = useRouter();
  const [entries, setEntries] = useState<PointEntry[]>(props.entries);
  useEffect(() => setEntries(props.entries), [props.entries]); // follow server refreshes
  const [settings, setSettings] = useState<ChapterSettings>(props.settings);
  useEffect(() => setSettings(props.settings), [props.settings]);
  const onLog = (e: PointEntry) => setEntries((x) => [e, ...x]);
  // Optimistic mirrors of the approve/reject/withdraw server actions, so the UI
  // updates instantly in mock mode (no server round-trip) and feels instant in live.
  const onApprove = (id: string, by: string) =>
    setEntries((x) => x.map((e) => (e.id === id ? { ...e, status: 'approved', approvedBy: by } : e)));
  const onRemove = (id: string) => setEntries((x) => x.filter((e) => e.id !== id));

  // Scoring config → the client engine. `scopeTermId` non-null means totals are
  // scoped to the current term (reset-each-term); the caller pre-filters entries.
  const cfg: ScoreConfig = { floor: settings.pointsFloor, ceiling: settings.pointsCeiling };
  const scopeTermId = settings.pointsResetEachTerm ? settings.currentTermId : null;
  const saveConfig = async (patch: PointsConfigPatch) => {
    setSettings((s) => ({ ...s, ...patch }));
    if (live) { await updatePointsConfig(patch); router.refresh(); }
  };

  if (role === 'member') {
    // Live: identify the signed-in member by their real membership id; mock/demo:
    // fall back to the persona-name lookup (matches Finances/Socials).
    const me = myMembershipId
      ? props.members.find((m) => m.membershipId === myMembershipId)
      : currentMember(props.members, persona);
    return me
      ? <MemberPoints me={me} members={props.members} entries={entries} items={props.items} live={live} cfg={cfg} scopeTermId={scopeTermId} onLog={onLog} onRemove={onRemove} />
      : <p style={{ color: 'var(--ink-500)' }}>No record on file.</p>;
  }
  return <ExecPoints members={props.members} entries={entries} items={props.items} onLog={onLog} onApprove={onApprove} onRemove={onRemove} live={live} cfg={cfg} scopeTermId={scopeTermId} settings={settings} onSaveConfig={saveConfig} meName={MOCK_USER[persona].name} />;
}

// Scope entries to a term when reset-each-term is on (scopeTermId non-null).
const scopeEntries = (entries: PointEntry[], scopeTermId: string | null) =>
  scopeTermId ? entries.filter((e) => e.termId === scopeTermId) : entries;

/* ─────────────────────────── Shared: catalog drawer ─────────────────────────── */

// Coerce a raw input to a catalog-legal value: an integer whose sign matches the
// item's kind. Downstream code (rewardPunishmentSplit, ptColor) keys off the
// SIGN, not `kind`, so a reward must stay ≥0 and a punishment ≤0 — otherwise a
// mistyped punishment would render green and count as earned when logged.
function coercePoints(raw: string, kind: PointItem['kind']): number | null {
  const n = Math.trunc(Number(raw));
  if (raw.trim() === '' || !Number.isFinite(n)) return null;
  const mag = Math.abs(n);
  return kind === 'punishment' ? -mag : mag;
}

// Exec catalog-edit handlers. Absent → the drawer is read-only (member view).
export interface CatalogEdit {
  update: (id: string, patch: PointItemPatch) => Promise<void> | void;
  create: (input: { label: string; points: number; kind: PointKind; discretionary: boolean }) => Promise<void> | void;
  archive: (id: string, archived: boolean) => Promise<void> | void;
  reorder: (updates: { id: string; sortOrder: number }[]) => Promise<void> | void;
}

interface RulesEditor {
  floor: number;
  ceiling: number | null;
  resetEachTerm: boolean;
  onSave: (patch: PointsConfigPatch) => Promise<void> | void;
}

function PointValuesDrawer({ items, onClose, edit, rules }: {
  items: PointItem[];
  onClose: () => void;
  edit?: CatalogEdit;
  rules?: RulesEditor;
}) {
  const editable = !!edit;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExp = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const busy = (fn: () => Promise<void> | void) => async (id: string) => {
    setBusyId(id);
    try { await fn(); } catch (err: any) { alert(err?.message ?? 'Could not save.'); }
    finally { setBusyId(null); }
  };

  const active = items.filter((i) => !i.archived);
  const archived = items.filter((i) => i.archived);
  const bySort = (a: PointItem, b: PointItem) => a.sortOrder - b.sortOrder;
  const rewards = active.filter((i) => i.kind === 'reward' && !i.discretionary).sort(bySort);
  const discretionary = active.filter((i) => i.discretionary).sort(bySort);
  const punishments = active.filter((i) => i.kind === 'punishment').sort(bySort);

  // Commit an uncontrolled input on blur: validate, skip no-ops, revert on invalid.
  const commitLabel = (i: PointItem, el: HTMLInputElement) => {
    const next = el.value.trim();
    if (next === '' || next === i.label) { el.value = i.label; return; }
    void busy(() => edit!.update(i.id, { label: next }))(i.id);
  };
  const commitValue = (i: PointItem, el: HTMLInputElement) => {
    const next = coercePoints(el.value, i.kind);
    if (next === null || next === i.points) { el.value = String(i.points); return; }
    el.value = String(next);   // reflect the sign coercion (a punishment stays ≤0)
    void busy(() => edit!.update(i.id, { points: next }))(i.id);
  };

  // Neighbor swap within a section: exchange the two rows' sort_order values.
  const move = (list: PointItem[], idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    const a = list[idx], b = list[j];
    void busy(() => edit!.reorder([{ id: a.id, sortOrder: b.sortOrder }, { id: b.id, sortOrder: a.sortOrder }]))(a.id);
  };

  // Flip reward↔punishment (moves the row to the other section). The value's sign
  // is coerced to match the new kind so it doesn't render green-but-negative.
  const flipKind = (i: PointItem) => {
    const kind: PointKind = i.kind === 'reward' ? 'punishment' : 'reward';
    void busy(() => edit!.update(i.id, { kind, points: coercePoints(String(i.points), kind) ?? 0 }))(i.id);
  };

  const arrow = (label: string, disabled: boolean, onClick: () => void) => (
    <button onClick={onClick} disabled={disabled || busyId !== null} title={label === '▲' ? 'Move up' : 'Move down'}
      style={{ height: 15, lineHeight: '15px', width: 18, padding: 0, fontSize: 10, border: 'none', background: 'none',
        cursor: disabled ? 'default' : 'pointer', color: disabled ? 'var(--cream-400)' : 'var(--ink-400)' }}>{label}</button>
  );

  // Advanced per-item rules (cap / auto-award / self-log), edited under the row.
  const commitCap = (i: PointItem, el: HTMLInputElement) => {
    const raw = el.value.trim();
    if (raw === '') { if (i.maxPerTerm !== null) void busy(() => edit!.update(i.id, { maxPerTerm: null }))(i.id); return; }
    const n = Math.trunc(Number(raw));
    if (!Number.isFinite(n) || n < 1) { el.value = i.maxPerTerm != null ? String(i.maxPerTerm) : ''; return; }
    if (n !== i.maxPerTerm) void busy(() => edit!.update(i.id, { maxPerTerm: n }))(i.id);
  };
  const AUTO_OPTS: { value: string; label: string }[] = [
    { value: '', label: 'Manual (no auto-award)' },
    { value: 'absent', label: 'Auto when Absent' },
    { value: 'late', label: 'Auto when Late' },
    { value: 'excused', label: 'Auto when Excused' },
    { value: 'present', label: 'Auto when Present' },
  ];
  const advanced = (i: PointItem) => (
    <div style={{ padding: '8px 0 10px 26px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: 'var(--ink-600)', display: 'flex', alignItems: 'center', gap: 6 }}>
          Cap / term
          <input type="number" min={1} step={1} defaultValue={i.maxPerTerm ?? ''} placeholder="∞" disabled={busyId !== null}
            onBlur={(e) => commitCap(i, e.target)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className="pkp-mono" style={{ width: 60, fontSize: 12, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--cream-400)', background: 'var(--white)' }} />
        </label>
        <label style={{ fontSize: 12, color: 'var(--ink-600)', display: 'flex', alignItems: 'center', gap: 6 }}>
          Attendance
          <select value={i.autoTrigger ?? ''} disabled={busyId !== null}
            onChange={(e) => void busy(() => edit!.update(i.id, { autoTrigger: (e.target.value || null) as AttendanceState | null }))(i.id)}
            style={{ fontSize: 12, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--cream-400)', background: 'var(--white)' }}>
            {AUTO_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>
      {!i.autoTrigger && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: 'var(--ink-600)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={i.selfLoggable ?? (i.kind === 'reward' && !i.discretionary)} disabled={busyId !== null}
              onChange={(e) => void busy(() => edit!.update(i.id, { selfLoggable: e.target.checked }))(i.id)} />
            Members can self-log
          </label>
          <label style={{ fontSize: 12, color: 'var(--ink-600)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={i.autoApprove} disabled={busyId !== null}
              onChange={(e) => void busy(() => edit!.update(i.id, { autoApprove: e.target.checked }))(i.id)} />
            Auto-approve self-logs
          </label>
        </div>
      )}
    </div>
  );

  const editRow = (list: PointItem[], i: PointItem, idx: number) => (
    <Fragment key={i.id}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--cream-200)', opacity: busyId === i.id ? 0.5 : 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          {arrow('▲', idx === 0, () => move(list, idx, -1))}
          {arrow('▼', idx === list.length - 1, () => move(list, idx, 1))}
        </div>
        <input defaultValue={i.label} disabled={busyId !== null}
          onBlur={(e) => commitLabel(i, e.target)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          style={{ flex: 1, minWidth: 0, fontSize: 13, padding: '5px 8px', borderRadius: 8, border: '1px solid var(--cream-400)', background: 'var(--white)', color: 'var(--ink-800)' }} />
        {!i.discretionary && (
          <button onClick={() => flipKind(i)} disabled={busyId !== null} title="Switch reward / punishment"
            className="pkp-mono" style={{ height: 28, width: 26, flexShrink: 0, padding: 0, fontSize: 15, lineHeight: 1, borderRadius: 8, border: '1px solid var(--cream-400)', background: 'var(--white)', cursor: busyId ? 'not-allowed' : 'pointer', color: ptColor(i.points) }}>
            {i.kind === 'reward' ? '+' : '−'}
          </button>
        )}
        {i.discretionary
          ? <span className="pkp-mono" style={{ width: 62, flexShrink: 0, textAlign: 'right', fontSize: 13, color: 'var(--ink-400)' }}>—</span>
          : <input className="pkp-mono" type="number" step={1} defaultValue={i.points} disabled={busyId !== null}
              onBlur={(e) => commitValue(i, e.target)}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              style={{ width: 62, flexShrink: 0, textAlign: 'right', fontSize: 13, fontWeight: 600, padding: '5px 8px', borderRadius: 8, border: '1px solid var(--cream-400)', background: 'var(--white)', color: ptColor(i.points) }} />}
        <button onClick={() => toggleExp(i.id)} disabled={busyId !== null} title="Rules (cap, auto-award, self-log)"
          className="pkp-btn-ghost" style={{ height: 28, width: 28, padding: 0, fontSize: 13, lineHeight: 1, flexShrink: 0, color: expanded.has(i.id) ? 'var(--pkp-primary)' : 'var(--ink-500)', cursor: busyId ? 'not-allowed' : 'pointer' }}>⚙</button>
        <button onClick={() => busy(() => edit!.archive(i.id, true))(i.id)} disabled={busyId !== null} title="Archive item"
          className="pkp-btn-ghost" style={{ height: 28, width: 28, padding: 0, fontSize: 13, lineHeight: 1, flexShrink: 0, color: 'var(--ink-500)', cursor: busyId ? 'not-allowed' : 'pointer' }}>✕</button>
      </div>
      {expanded.has(i.id) && advanced(i)}
    </Fragment>
  );

  const readRow = (i: PointItem) => (
    <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '1px solid var(--cream-200)' }}>
      <span style={{ fontSize: 13, color: 'var(--ink-700)' }}>{i.label}</span>
      <span className="pkp-mono" style={{ fontSize: 13, fontWeight: 600, flexShrink: 0, color: i.discretionary ? 'var(--ink-400)' : ptColor(i.points) }}>
        {i.discretionary ? '—' : signed(i.points)}
      </span>
    </div>
  );

  const section = (title: string, list: PointItem[]) => (
    <div className="pkp-card" style={{ padding: 16 }}>
      <div className="pkp-col-head" style={{ marginBottom: 4 }}>{title}</div>
      {list.map((i, idx) => (editable ? editRow(list, i, idx) : readRow(i)))}
      {editable && list.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-400)', padding: '8px 0', borderTop: '1px solid var(--cream-200)' }}>No items.</div>}
    </div>
  );

  return (
    <Drawer
      onClose={onClose}
      bodyGap={16}
      header={
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600, color: 'var(--ink-900)' }}>Point values</h2>
          <div style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 3 }}>
            {editable ? 'Edit a label or value and tab away to save · changes apply to future awards only' : `Accountability catalog · floor of ${POINT_FLOOR}`}
          </div>
        </div>
      }
    >
      {rules && <RulesCard rules={rules} />}
      {editable && (
        adding
          ? <AddItemForm onCancel={() => setAdding(false)} onCreate={async (input) => { await edit!.create(input); setAdding(false); }} />
          : <button className="pkp-btn-ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px', fontSize: 12.5, alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>
              <span style={{ display: 'inline-flex' }}>{icons.plus}</span>Add item
            </button>
      )}
      {section('Rewards', rewards)}
      {section('Discretionary (GP/VP sets value)', discretionary)}
      {section('Punishments', punishments)}
      {editable && archived.length > 0 && (
        <div className="pkp-card" style={{ padding: 16 }}>
          <div className="pkp-col-head" style={{ marginBottom: 4 }}>Archived ({archived.length})</div>
          {archived.sort(bySort).map((i) => (
            <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '7px 0', borderTop: '1px solid var(--cream-200)', opacity: busyId === i.id ? 0.5 : 1 }}>
              <span style={{ fontSize: 13, color: 'var(--ink-400)', textDecoration: 'line-through' }}>{i.label}</span>
              <button onClick={() => busy(() => edit!.archive(i.id, false))(i.id)} disabled={busyId !== null}
                className="pkp-btn-ghost" style={{ height: 28, padding: '0 11px', fontSize: 12, flexShrink: 0, cursor: busyId ? 'not-allowed' : 'pointer' }}>Restore</button>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}

// Chapter-wide scoring rules: floor (required), ceiling (blank = none), and
// reset-each-term. Numbers commit on blur; the toggle saves immediately.
function RulesCard({ rules }: { rules: RulesEditor }) {
  const [busy, setBusy] = useState(false);
  const save = (patch: PointsConfigPatch) => {
    setBusy(true);
    Promise.resolve(rules.onSave(patch)).catch((e: any) => alert(e?.message ?? 'Could not save.')).finally(() => setBusy(false));
  };
  const commitNum = (el: HTMLInputElement, current: number | null, key: 'pointsFloor' | 'pointsCeiling', allowBlank: boolean) => {
    const raw = el.value.trim();
    if (raw === '') {
      if (allowBlank) { if (current !== null) save({ [key]: null } as PointsConfigPatch); }
      else el.value = current != null ? String(current) : '';
      return;
    }
    const n = Math.trunc(Number(raw));
    if (!Number.isFinite(n)) { el.value = current != null ? String(current) : ''; return; }
    if (n !== current) save({ [key]: n } as PointsConfigPatch);
  };
  const numInput = (defaultValue: string, current: number | null, key: 'pointsFloor' | 'pointsCeiling', allowBlank: boolean, placeholder?: string) => (
    <input type="number" step={1} defaultValue={defaultValue} placeholder={placeholder} disabled={busy}
      onBlur={(e) => commitNum(e.target, current, key, allowBlank)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className="pkp-mono" style={{ width: 64, fontSize: 13, padding: '5px 8px', borderRadius: 8, border: '1px solid var(--cream-400)', background: 'var(--white)' }} />
  );
  return (
    <div className="pkp-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="pkp-col-head">Scoring rules</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, color: 'var(--ink-700)', display: 'flex', alignItems: 'center', gap: 7 }}>
          Floor {numInput(String(rules.floor), rules.floor, 'pointsFloor', false)}
        </label>
        <label style={{ fontSize: 13, color: 'var(--ink-700)', display: 'flex', alignItems: 'center', gap: 7 }}>
          Ceiling {numInput(rules.ceiling != null ? String(rules.ceiling) : '', rules.ceiling, 'pointsCeiling', true, '∞')}
        </label>
      </div>
      <label style={{ fontSize: 13, color: 'var(--ink-700)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={rules.resetEachTerm} disabled={busy} onChange={(e) => save({ pointsResetEachTerm: e.target.checked })} />
        Reset totals each term
      </label>
      <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>
        Floor = the lowest a member&apos;s total can drop to. Ceiling blank = no cap. Reset scopes totals to the current term.
      </div>
    </div>
  );
}

// Inline "add catalog item" form. Discretionary items carry no fixed value
// (exec sets it per award), so the value field hides when that box is checked.
function AddItemForm({ onCancel, onCreate }: {
  onCancel: () => void;
  onCreate: (input: { label: string; points: number; kind: PointKind; discretionary: boolean }) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<PointKind>('reward');
  const [discretionary, setDiscretionary] = useState(false);
  const [pts, setPts] = useState('');
  const [busy, setBusy] = useState(false);

  const value = discretionary ? 0 : (coercePoints(pts, kind) ?? 0);
  const canSave = label.trim() !== '' && (discretionary || coercePoints(pts, kind) !== null);

  const submit = async () => {
    if (!canSave) return;
    setBusy(true);
    try { await onCreate({ label: label.trim(), points: value, kind, discretionary }); }
    catch (err: any) { alert(err?.message ?? 'Could not add item.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="pkp-card" style={{ padding: 16, borderColor: 'var(--pkp-accent)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="pkp-col-head">New item</div>
      <Field label="Label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Attend alumni event" />
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <Select label="Kind" value={kind} onChange={(e) => setKind(e.target.value as PointKind)}
            options={[{ value: 'reward', label: 'Reward (+)' }, { value: 'punishment', label: 'Punishment (−)' }]} />
        </div>
        {!discretionary && (
          <div style={{ width: 110 }}>
            <Field label="Points" type="number" value={pts} onChange={(e) => setPts(e.target.value)} placeholder={kind === 'punishment' ? '-5' : '5'} />
          </div>
        )}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-600)', cursor: 'pointer' }}>
        <input type="checkbox" checked={discretionary} onChange={(e) => setDiscretionary(e.target.checked)} />
        Discretionary — officer sets the value each time it&apos;s awarded
      </label>
      <ModalActions onCancel={onCancel} onSave={submit} canSave={canSave && !busy} saveLabel={busy ? 'Adding…' : 'Add item'} />
    </div>
  );
}

/* ─────────────────────────── Exec: leaderboard + log ─────────────────────────── */

function ExecPoints({ members, entries, items: itemsProp, onLog, onApprove, onRemove, meName, live = false, cfg, scopeTermId, settings, onSaveConfig }: Props & {
  onLog: (e: PointEntry) => void;
  onApprove: (id: string, by: string) => void;
  onRemove: (id: string) => void;
  meName: string;
  cfg: ScoreConfig;
  scopeTermId: string | null;
  onSaveConfig: (patch: PointsConfigPatch) => Promise<void> | void;
}) {
  const router = useRouter();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [logging, setLogging] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [items, setItems] = useState<PointItem[]>(itemsProp);
  useEffect(() => setItems(itemsProp), [itemsProp]); // follow server refreshes

  const nameOf = (id: string) => members.find((m) => m.membershipId === id)?.fullName ?? 'Unknown';
  const avatarOf = (id: string) => members.find((m) => m.membershipId === id)?.avatarUrl ?? null;
  // Member self-log requests awaiting a decision — the queue exec clears at a glance.
  const pending = useMemo(
    () => entries.filter((e) => e.status === 'pending').sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [entries],
  );

  const approve = async (e: PointEntry) => {
    setBusyId(e.id);
    try {
      if (live) { await approvePointEntry(e.id); router.refresh(); }
      onApprove(e.id, meName); // optimistic; live refresh overwrites approvedBy with the real approver
    } catch (err: any) {
      alert(err?.message ?? 'Could not approve.');
    } finally {
      setBusyId(null);
    }
  };
  const reject = async (e: PointEntry) => {
    setBusyId(e.id);
    try {
      if (live) { await rejectPointEntry(e.id); router.refresh(); }
      onRemove(e.id);
    } catch (err: any) {
      alert(err?.message ?? 'Could not reject.');
    } finally {
      setBusyId(null);
    }
  };

  // Catalog editing (exec-only; RLS is the real gate). Every handler is optimistic
  // — update local state so the drawer + Log modal reflect it immediately — and in
  // live mode also writes to Supabase and refreshes so a reload shows the same.
  const catalogEdit: CatalogEdit = {
    update: async (id, patch) => {
      setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      if (live) { await updatePointItem(id, patch); router.refresh(); }
    },
    create: async (input) => {
      const points = input.discretionary ? 0 : input.points;
      const extra = { archived: false, maxPerTerm: null, autoTrigger: null, selfLoggable: null, autoApprove: false } as const;
      if (live) {
        const { id, sortOrder } = await createPointItem(input);
        setItems((xs) => [...xs, { ...input, points, id, sortOrder, ...extra }]);
        router.refresh();
      } else {
        const sortOrder = Math.max(0, ...items.map((x) => x.sortOrder)) + 1;
        setItems((xs) => [...xs, { ...input, points, id: `pi-local-${Date.now()}`, sortOrder, ...extra }]);
      }
    },
    archive: async (id, archived) => {
      setItems((xs) => xs.map((x) => (x.id === id ? { ...x, archived } : x)));
      if (live) { await archivePointItem(id, archived); router.refresh(); }
    },
    reorder: async (updates) => {
      setItems((xs) => xs.map((x) => { const u = updates.find((v) => v.id === x.id); return u ? { ...x, sortOrder: u.sortOrder } : x; }));
      if (live) { await reorderPointItems(updates); router.refresh(); }
    },
  };

  // Totals derive from term-scoped, floor/ceiling-clamped entries; the pending
  // queue above still reads raw `entries` (a request shows regardless of term).
  const scoped = useMemo(() => scopeEntries(entries, scopeTermId), [entries, scopeTermId]);
  const totalOf = (id: string) => memberPointTotal(scoped, id, cfg);
  const ranked = useMemo(() => [...members].sort((a, b) => totalOf(b.membershipId) - totalOf(a.membershipId)), [members, scoped, cfg.floor, cfg.ceiling]);
  const topPoints = Math.max(1, ...members.map((m) => Math.max(0, totalOf(m.membershipId))));
  const change = (id: string) => weekChange(scoped, id, NOW);
  const motm = useMemo(
    () => [...members].sort((a, b) => change(b.membershipId) - change(a.membershipId))[0],
    [members, scoped],
  );

  return (
    <>
      {pending.length > 0 && (
        <div className="pkp-card" style={{ padding: 20, borderColor: 'var(--pkp-accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 12 }}>
            <h3 className="pkp-h3">Pending approvals</h3>
            <span className="pkp-mono" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--pkp-primary)' }}>{pending.length}</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginBottom: 8 }}>Points brothers logged themselves — approve to count them.</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {pending.map((e, i) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i ? '1px solid var(--cream-200)' : 'none', opacity: busyId === e.id ? 0.5 : 1 }}>
                <MemberAvatar name={nameOf(e.membershipId)} src={avatarOf(e.membershipId)} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(e.membershipId)}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label} · {relativeDay(e.date, NOW)}</div>
                </div>
                <span className="pkp-mono" style={{ fontSize: 13.5, fontWeight: 600, flexShrink: 0, color: ptColor(e.points) }}>{signed(e.points)}</span>
                <button onClick={() => approve(e)} disabled={busyId !== null} title="Approve"
                  className="pkp-btn-primary" style={{ height: 32, padding: '0 13px', fontSize: 12.5, flexShrink: 0, cursor: busyId ? 'not-allowed' : 'pointer' }}>Approve</button>
                <button onClick={() => reject(e)} disabled={busyId !== null} title="Reject"
                  className="pkp-btn-ghost" style={{ height: 32, width: 32, padding: 0, fontSize: 15, lineHeight: 1, flexShrink: 0, color: 'var(--ink-500)', cursor: busyId ? 'not-allowed' : 'pointer' }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="pkp-card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
          <h3 className="pkp-h3">Points leaderboard</h3>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="pkp-btn-ghost" style={{ height: 36, padding: '0 14px', fontSize: 12.5 }} onClick={() => setCatalogOpen(true)}>Point values</button>
            <button className="pkp-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px', fontSize: 12.5 }} onClick={() => setLogging(true)}>
              <span style={{ display: 'inline-flex' }}>{icons.plus}</span>Log points
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {ranked.map((m, i) => {
            const wk = change(m.membershipId);
            const total = totalOf(m.membershipId);
            const isMotm = motm && m.membershipId === motm.membershipId;
            return (
              <div key={m.membershipId} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 0', borderTop: i ? '1px solid var(--cream-200)' : 'none' }}>
                <div className="pkp-mono" style={{ width: 26, flexShrink: 0, textAlign: 'center', fontSize: 14, fontWeight: 700, color: i < 3 ? 'var(--pkp-primary)' : 'var(--ink-400)' }}>{i + 1}</div>
                <MemberAvatar name={m.fullName} src={m.avatarUrl} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-900)' }}>{m.fullName}</span>
                    {isMotm && <Badge tone="warning">🏆 Month</Badge>}
                  </div>
                  <div style={{ height: 6, borderRadius: 999, background: 'var(--cream-300)', overflow: 'hidden', marginTop: 6 }}>
                    <div style={{ width: `${(Math.max(0, total) / topPoints) * 100}%`, height: '100%', borderRadius: 999, background: 'var(--pkp-accent)' }} />
                  </div>
                </div>
                {wk !== 0 && <span className="pkp-mono" style={{ width: 40, textAlign: 'right', flexShrink: 0, fontSize: 12, color: ptColor(wk) }}>{signed(wk)}</span>}
                <div className="pkp-mono pkp-r" style={{ width: 44, flexShrink: 0, fontSize: 14, fontWeight: 600, color: ptColor(total) }}>{total}</div>
              </div>
            );
          })}
        </div>
      </div>

      {catalogOpen && (
        <PointValuesDrawer
          items={items} onClose={() => setCatalogOpen(false)} edit={catalogEdit}
          rules={{ floor: settings.pointsFloor, ceiling: settings.pointsCeiling, resetEachTerm: settings.pointsResetEachTerm, onSave: onSaveConfig }}
        />
      )}
      {logging && (
        <LogPointsModal
          members={members} items={items} live={live}
          onClose={() => setLogging(false)}
          onLog={(e) => { onLog(e); setLogging(false); }}
        />
      )}
    </>
  );
}

function LogPointsModal({ members, items, live, onClose, onLog }: {
  members: MemberRow[]; items: PointItem[]; live: boolean; onClose: () => void; onLog: (e: PointEntry) => void;
}) {
  const router = useRouter();
  // Auto-owned items (auto_trigger set) are awarded by attendance — never logged
  // by hand (option C: no double-counting) — so they're out of the manual picker.
  const active = useMemo(() => items.filter((it) => !it.archived && !it.autoTrigger), [items]);
  const [memberId, setMemberId] = useState(members[0]?.membershipId ?? '');
  const [itemId, setItemId] = useState(active[0]?.id ?? '');
  const [approvedBy, setApprovedBy] = useState('');
  const [customPts, setCustomPts] = useState('');
  const [busy, setBusy] = useState(false);

  const item = active.find((it) => it.id === itemId);
  const points = item?.discretionary ? Number(customPts) || 0 : item?.points ?? 0;
  const canSave = !!memberId && !!item && approvedBy.trim() !== '' && (!item.discretionary || customPts !== '');

  const submit = async () => {
    if (!canSave || !item) return;
    if (!live) {
      onLog({
        id: `pe-local-${Date.now()}`, membershipId: memberId, itemId: item.id, label: item.label,
        points, date: NOW.toISOString(), approvedBy: approvedBy.trim(), status: 'approved',
      });
      return;
    }
    setBusy(true);
    try {
      await logPoints(memberId, item.id, points, approvedBy.trim());
      router.refresh();
      onClose();
    } catch (err: any) {
      alert(err?.message ?? 'Could not log points.');
    } finally {
      setBusy(false);
    }
  };

  const opts = active.map((it) => ({
    value: it.id,
    label: `${it.label}${it.discretionary ? ' (set value)' : `  (${it.points > 0 ? '+' : ''}${it.points})`}`,
  }));

  return (
    <Modal title="Log points" sub="Award or deduct against the catalog" onClose={onClose} width={500}
      footer={<ModalActions onCancel={onClose} onSave={submit} canSave={canSave && !busy} saveLabel={busy ? 'Logging…' : `Log ${signed(points)}`} />}>
      <Select label="Brother" value={memberId} onChange={(e) => setMemberId(e.target.value)}
        options={members.map((m) => ({ value: m.membershipId, label: m.fullName }))} />
      <Select label="Item" value={itemId} onChange={(e) => setItemId(e.target.value)} options={opts} />
      {item?.discretionary && (
        <Field label="Points (discretionary)" type="number" value={customPts} onChange={(e) => setCustomPts(e.target.value)} placeholder="e.g. 5" />
      )}
      <Field label="Approved by" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} placeholder="Officer name" />
    </Modal>
  );
}

/* ─────────────────────────── Member: your points + ledger ─────────────────────────── */

function MemberPoints({ me, members, entries, items, live, cfg, scopeTermId, onLog, onRemove }: {
  me: MemberRow; members: MemberRow[]; entries: PointEntry[]; items: PointItem[];
  live: boolean; cfg: ScoreConfig; scopeTermId: string | null;
  onLog: (e: PointEntry) => void; onRemove: (id: string) => void;
}) {
  const router = useRouter();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Opened straight from the dashboard "Log points" button, which sets this flag
  // before navigating here (same pattern as the events tab's pkp-focus-event).
  useEffect(() => {
    if (sessionStorage.getItem('pkp-open-points-log')) {
      sessionStorage.removeItem('pkp-open-points-log');
      setLogOpen(true);
    }
  }, []);

  // Totals/ledger derive from term-scoped entries; pending requests show regardless.
  const scoped = useMemo(() => scopeEntries(entries, scopeTermId), [entries, scopeTermId]);
  const myTotal = memberPointTotal(scoped, me.membershipId, cfg);
  const rank = [...members].sort((a, b) => memberPointTotal(scoped, b.membershipId, cfg) - memberPointTotal(scoped, a.membershipId, cfg)).findIndex((m) => m.membershipId === me.membershipId) + 1;
  const mine = useMemo(
    () => entriesFor(scoped, me.membershipId).filter((e) => e.status === 'approved').sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [scoped, me.membershipId],
  );
  const myPending = useMemo(
    () => pendingFor(entries, me.membershipId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [entries, me.membershipId],
  );
  const split = rewardPunishmentSplit(scoped, me.membershipId);
  const wk = weekChange(scoped, me.membershipId, NOW);

  // Cancel a request an officer hasn't acted on yet (RLS lets a member delete
  // only their own still-pending row).
  const withdraw = async (e: PointEntry) => {
    setBusyId(e.id);
    try {
      if (live) { await withdrawPointRequest(e.id); router.refresh(); }
      onRemove(e.id);
    } catch (err: any) {
      alert(err?.message ?? 'Could not withdraw.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ maxWidth: 660, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="pkp-card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12 }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-500)' }}>Your points</div>
            <div className="pkp-mono" style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.05, marginTop: 4, color: ptColor(myTotal) }}>{myTotal}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginTop: 4 }}>
              #{rank} in chapter · {wk !== 0 ? `${signed(wk)} this week` : 'no change this week'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            <button className="pkp-btn-ghost" style={{ height: 34, padding: '0 13px', fontSize: 12.5 }} onClick={() => setCatalogOpen(true)}>Point values</button>
            <button className="pkp-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px', fontSize: 12.5 }} onClick={() => setLogOpen(true)}>
              <span style={{ display: 'inline-flex' }}>{icons.plus}</span>Log points
            </button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div className="pkp-card" style={{ padding: 13 }}>
            <div className="pkp-mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--success-600)' }}>{signed(split.reward)}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 4 }}>Earned</div>
          </div>
          <div className="pkp-card" style={{ padding: 13 }}>
            <div className="pkp-mono" style={{ fontSize: 18, fontWeight: 600, color: split.punishment < 0 ? 'var(--pkp-primary)' : 'var(--ink-500)' }}>{signed(split.punishment)}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 4 }}>Deductions</div>
          </div>
        </div>

        {myPending.length > 0 && (
          <>
            <div className="pkp-col-head" style={{ marginBottom: 4 }}>Awaiting approval</div>
            <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 16 }}>
              {myPending.map((e) => (
                <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 11, padding: '10px 0', borderTop: '1px solid var(--cream-200)', opacity: busyId === e.id ? 0.5 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: 'var(--ink-400)' }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--ink-800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</div>
                      <div className="pkp-mono" style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 2 }}>{relativeDay(e.date, NOW)} · pending officer approval</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <Badge tone="neutral">{signed(e.points)} pending</Badge>
                    <button onClick={() => withdraw(e)} disabled={busyId !== null} title="Withdraw request"
                      className="pkp-btn-ghost" style={{ height: 28, width: 28, padding: 0, fontSize: 13, lineHeight: 1, color: 'var(--ink-500)', cursor: busyId ? 'not-allowed' : 'pointer' }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="pkp-col-head" style={{ marginBottom: 4 }}>Ledger</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {mine.map((e) => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 11, padding: '10px 0', borderTop: '1px solid var(--cream-200)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: ptColor(e.points) }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--ink-800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</div>
                  <div className="pkp-mono" style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 2 }}>{relativeDay(e.date, NOW)} · {e.approvedBy}</div>
                </div>
              </div>
              <span className="pkp-mono" style={{ fontSize: 13.5, fontWeight: 600, flexShrink: 0, color: ptColor(e.points) }}>{signed(e.points)}</span>
            </div>
          ))}
          {mine.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-500)', padding: '10px 0' }}>No approved entries yet.</div>}
        </div>
      </div>

      {catalogOpen && <PointValuesDrawer items={items} onClose={() => setCatalogOpen(false)} />}
      {logOpen && <RequestPointsModal me={me} items={items} live={live} onClose={() => setLogOpen(false)} onLog={onLog} />}
    </div>
  );
}

// Member self-log: pick a reward you earned; it goes to exec as a pending request
// at the catalog value (no brother picker, no value entry — RLS enforces both).
function RequestPointsModal({ me, items, live, onClose, onLog }: {
  me: MemberRow; items: PointItem[]; live: boolean; onClose: () => void; onLog: (e: PointEntry) => void;
}) {
  const router = useRouter();
  // Self-loggable = the item's selfLoggable override, or the default (reward &
  // non-discretionary). Always excludes discretionary, archived, and auto-owned
  // items — matching the points_entries_self_request RLS policy.
  const selfItems = useMemo(
    () => items.filter((it) => !it.archived && !it.discretionary && !it.autoTrigger && (it.selfLoggable ?? it.kind === 'reward')),
    [items],
  );
  const [itemId, setItemId] = useState(selfItems[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  const item = selfItems.find((it) => it.id === itemId);
  const points = item?.points ?? 0;

  const auto = !!item?.autoApprove;   // auto-approve items count immediately, no queue

  const submit = async () => {
    if (!item) return;
    if (!live) {
      onLog({
        id: `pe-local-${Date.now()}`, membershipId: me.membershipId, itemId: item.id, label: item.label,
        points, date: NOW.toISOString(), approvedBy: auto ? 'Auto-approved' : '', status: auto ? 'approved' : 'pending',
      });
      onClose();
      return;
    }
    setBusy(true);
    try {
      await requestPoints(me.membershipId, item.id, points);
      router.refresh();
      onClose();
    } catch (err: any) {
      alert(err?.message ?? 'Could not submit request.');
    } finally {
      setBusy(false);
    }
  };

  const opts = selfItems.map((it) => ({ value: it.id, label: `${it.label}  (${signed(it.points)})` }));

  return (
    <Modal title="Log points" sub={auto ? 'Counts immediately' : 'Submit for an officer to approve'} onClose={onClose} width={500}
      footer={<ModalActions onCancel={onClose} onSave={submit} canSave={!!item && !busy} saveLabel={busy ? 'Submitting…' : (auto ? `Log ${signed(points)}` : `Request ${signed(points)}`)} />}>
      <Select label="What did you do?" value={itemId} onChange={(e) => setItemId(e.target.value)} options={opts} />
      <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginTop: 6 }}>
        Worth <strong style={{ color: ptColor(points) }}>{signed(points)}</strong>
        {auto ? ' — counts toward your total right away.' : ' once an officer approves it — it won’t count toward your total until then.'}
      </div>
    </Modal>
  );
}
