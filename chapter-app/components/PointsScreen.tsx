'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MemberRow, PointEntry, PointItem } from '@/lib/types';
import { relativeDay } from '@/lib/format';
import { NOW } from '@/lib/engagement';
import { entriesFor, weekChange, rewardPunishmentSplit, memberPointTotal, pendingFor, POINT_FLOOR } from '@/lib/points';
import { currentMember, MOCK_USER } from '@/lib/session';
import { logPoints, updatePointItem, requestPoints, approvePointEntry, rejectPointEntry, withdrawPointRequest } from '@/app/points/actions';
import { useApp } from './Providers';
import { Avatar, Badge } from './ui';
import { icons } from './icons';
import { Modal, ModalActions, Field, Select } from './form';

const ptColor = (n: number) => (n > 0 ? 'var(--success-600)' : n < 0 ? 'var(--pkp-primary)' : 'var(--ink-500)');
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

type Props = { members: MemberRow[]; entries: PointEntry[]; items: PointItem[]; live?: boolean };

export function PointsScreen({ live = false, ...props }: Props) {
  const { role, persona } = useApp();
  const [entries, setEntries] = useState<PointEntry[]>(props.entries);
  useEffect(() => setEntries(props.entries), [props.entries]); // follow server refreshes
  const onLog = (e: PointEntry) => setEntries((x) => [e, ...x]);
  // Optimistic mirrors of the approve/reject/withdraw server actions, so the UI
  // updates instantly in mock mode (no server round-trip) and feels instant in live.
  const onApprove = (id: string, by: string) =>
    setEntries((x) => x.map((e) => (e.id === id ? { ...e, status: 'approved', approvedBy: by } : e)));
  const onRemove = (id: string) => setEntries((x) => x.filter((e) => e.id !== id));

  if (role === 'member') {
    const me = currentMember(props.members, persona);
    return me
      ? <MemberPoints me={me} members={props.members} entries={entries} items={props.items} live={live} onLog={onLog} onRemove={onRemove} />
      : <p style={{ color: 'var(--ink-500)' }}>No record on file.</p>;
  }
  return <ExecPoints members={props.members} entries={entries} items={props.items} onLog={onLog} onApprove={onApprove} onRemove={onRemove} live={live} meName={MOCK_USER[persona].name} />;
}

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

function PointValuesDrawer({ items, onClose, onSave }: {
  items: PointItem[];
  onClose: () => void;
  // Present → exec can edit fixed values. Persists one item; resolves when saved.
  onSave?: (itemId: string, points: number) => Promise<void> | void;
}) {
  const editable = !!onSave;
  // Draft text per item, keyed by id. Undefined = untouched (show catalog value).
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const rewards = items.filter((i) => i.kind === 'reward' && !i.discretionary).sort((a, b) => b.points - a.points);
  const discretionary = items.filter((i) => i.discretionary);
  const punishments = items.filter((i) => i.kind === 'punishment').sort((a, b) => b.points - a.points);

  const commit = async (i: PointItem) => {
    const text = draft[i.id];
    if (text === undefined) return;                 // untouched
    const next = coercePoints(text, i.kind);
    if (next === null || next === i.points) {        // invalid or unchanged → revert
      setDraft(({ [i.id]: _, ...rest }) => rest);
      return;
    }
    setSavingId(i.id);
    try {
      await onSave!(i.id, next);
      setDraft(({ [i.id]: _, ...rest }) => rest);    // clear draft; parent state now holds it
    } catch (err: any) {
      alert(err?.message ?? 'Could not save.');
    } finally {
      setSavingId(null);
    }
  };

  const editRow = (i: PointItem) => {
    const val = draft[i.id] ?? String(i.points);
    return (
      <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '7px 0', borderTop: '1px solid var(--cream-200)' }}>
        <span style={{ fontSize: 13, color: 'var(--ink-700)' }}>{i.label}</span>
        <input
          className="pkp-mono" type="number" step={1} value={val}
          disabled={savingId === i.id}
          onChange={(e) => setDraft((d) => ({ ...d, [i.id]: e.target.value }))}
          onBlur={() => commit(i)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          style={{
            width: 62, flexShrink: 0, textAlign: 'right', fontSize: 13, fontWeight: 600,
            padding: '5px 8px', borderRadius: 8, border: '1px solid var(--cream-400)',
            background: 'var(--white)', color: ptColor(i.points),
          }}
        />
      </div>
    );
  };

  const readRow = (i: PointItem) => (
    <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '1px solid var(--cream-200)' }}>
      <span style={{ fontSize: 13, color: 'var(--ink-700)' }}>{i.label}</span>
      <span className="pkp-mono" style={{ fontSize: 13, fontWeight: 600, flexShrink: 0, color: i.discretionary ? 'var(--ink-400)' : ptColor(i.points) }}>
        {i.discretionary ? '—' : signed(i.points)}
      </span>
    </div>
  );

  // Discretionary items have no fixed value (exec sets it per entry) — never editable here.
  const row = (i: PointItem) => (editable && !i.discretionary ? editRow(i) : readRow(i));

  const section = (title: string, list: PointItem[]) => (
    <div className="pkp-card" style={{ padding: 16 }}>
      <div className="pkp-col-head" style={{ marginBottom: 4 }}>{title}</div>
      {list.map(row)}
    </div>
  );
  return (
    <>
      <div className="pkp-scrim" onClick={onClose} />
      <div className="pkp-drawer">
        <div style={{ padding: 22, borderBottom: '1px solid var(--cream-300)', display: 'flex', alignItems: 'flex-start', gap: 16, background: 'var(--white)' }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600, color: 'var(--ink-900)' }}>Point values</h2>
            <div style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 3 }}>
              {editable ? 'Edit a value and tab away to save · applies to future awards only' : `Accountability catalog · floor of ${POINT_FLOOR}`}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--cream-400)', background: 'var(--white)', color: 'var(--ink-500)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {section('Rewards', rewards)}
          {section('Discretionary (GP/VP sets value)', discretionary)}
          {section('Punishments', punishments)}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────── Exec: leaderboard + log ─────────────────────────── */

function ExecPoints({ members, entries, items: itemsProp, onLog, onApprove, onRemove, meName, live = false }: Props & {
  onLog: (e: PointEntry) => void;
  onApprove: (id: string, by: string) => void;
  onRemove: (id: string) => void;
  meName: string;
}) {
  const router = useRouter();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [logging, setLogging] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [items, setItems] = useState<PointItem[]>(itemsProp);
  useEffect(() => setItems(itemsProp), [itemsProp]); // follow server refreshes

  const nameOf = (id: string) => members.find((m) => m.membershipId === id)?.fullName ?? 'Unknown';
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

  // Persist a catalog value edit (exec-only; RLS is the real gate). Optimistic:
  // update local state so the drawer + Log modal reflect it immediately; in live
  // mode also write to Supabase and refresh so a reload shows the same.
  const saveItem = async (itemId: string, points: number) => {
    setItems((xs) => xs.map((x) => (x.id === itemId ? { ...x, points } : x)));
    if (live) {
      await updatePointItem(itemId, points);
      router.refresh();
    }
  };

  const totalOf = (id: string) => memberPointTotal(entries, id);
  const ranked = useMemo(() => [...members].sort((a, b) => totalOf(b.membershipId) - totalOf(a.membershipId)), [members, entries]);
  const topPoints = Math.max(1, ...members.map((m) => Math.max(0, totalOf(m.membershipId))));
  const change = (id: string) => weekChange(entries, id, NOW);
  const motm = useMemo(
    () => [...members].sort((a, b) => change(b.membershipId) - change(a.membershipId))[0],
    [members, entries],
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
                <Avatar name={nameOf(e.membershipId)} size={30} />
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
                <Avatar name={m.fullName} size={32} />
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

      {catalogOpen && <PointValuesDrawer items={items} onClose={() => setCatalogOpen(false)} onSave={saveItem} />}
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
  const [memberId, setMemberId] = useState(members[0]?.membershipId ?? '');
  const [itemId, setItemId] = useState(items[0]?.id ?? '');
  const [approvedBy, setApprovedBy] = useState('');
  const [customPts, setCustomPts] = useState('');
  const [busy, setBusy] = useState(false);

  const item = items.find((it) => it.id === itemId);
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

  const opts = items.map((it) => ({
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

function MemberPoints({ me, members, entries, items, live, onLog, onRemove }: {
  me: MemberRow; members: MemberRow[]; entries: PointEntry[]; items: PointItem[];
  live: boolean; onLog: (e: PointEntry) => void; onRemove: (id: string) => void;
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

  const myTotal = memberPointTotal(entries, me.membershipId);
  const rank = [...members].sort((a, b) => memberPointTotal(entries, b.membershipId) - memberPointTotal(entries, a.membershipId)).findIndex((m) => m.membershipId === me.membershipId) + 1;
  const mine = useMemo(
    () => entriesFor(entries, me.membershipId).filter((e) => e.status === 'approved').sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [entries, me.membershipId],
  );
  const myPending = useMemo(
    () => pendingFor(entries, me.membershipId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [entries, me.membershipId],
  );
  const split = rewardPunishmentSplit(entries, me.membershipId);
  const wk = weekChange(entries, me.membershipId, NOW);

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
  // Members may self-log only fixed-value rewards; punishments + discretionary items stay exec-only.
  const selfItems = useMemo(() => items.filter((it) => it.kind === 'reward' && !it.discretionary), [items]);
  const [itemId, setItemId] = useState(selfItems[0]?.id ?? '');
  const [busy, setBusy] = useState(false);

  const item = selfItems.find((it) => it.id === itemId);
  const points = item?.points ?? 0;

  const submit = async () => {
    if (!item) return;
    if (!live) {
      onLog({
        id: `pe-local-${Date.now()}`, membershipId: me.membershipId, itemId: item.id, label: item.label,
        points, date: NOW.toISOString(), approvedBy: '', status: 'pending',
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

  const opts = selfItems.map((it) => ({ value: it.id, label: `${it.label}  (+${it.points})` }));

  return (
    <Modal title="Log points" sub="Submit for an officer to approve" onClose={onClose} width={500}
      footer={<ModalActions onCancel={onClose} onSave={submit} canSave={!!item && !busy} saveLabel={busy ? 'Submitting…' : `Request +${points}`} />}>
      <Select label="What did you do?" value={itemId} onChange={(e) => setItemId(e.target.value)} options={opts} />
      <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginTop: 6 }}>
        Worth <strong style={{ color: 'var(--success-600)' }}>+{points}</strong> once an officer approves it — it won’t count toward your total until then.
      </div>
    </Modal>
  );
}
