'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { MemberRow, ChapterStats } from '@/lib/types';
import type { ChapterSettings } from '@/lib/data';
import { money, duesBadge, fmtDate } from '@/lib/format';
import {
  currentDuesCents, CURRENT_QUARTER_LABEL, duesFor, quarterLedger,
  finesFor, finesOutstanding, currentMember, type Fine,
} from '@/lib/session';
import { NOW } from '@/lib/engagement';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { CHAPTER_ID } from '@/lib/chapter';
import { useApp } from './Providers';
import { Avatar, Badge, Chips, StatCards, AddButton, MiniStat, Drawer } from './ui';
import { icons } from './icons';
import { Switch } from './AccessScreen';
import { Modal, ModalActions, Field, Select, FieldRow, downloadCsv } from './form';

// Starts a Stripe Checkout session for `kind` ('dues' | 'fines') and redirects
// there. Server (app/api/stripe/checkout) is the source of truth on whether
// payments are actually on — this is UX gating, not the real gate.
async function startCheckout(kind: 'dues' | 'fines', amountCents: number): Promise<{ url?: string; error?: string }> {
  try {
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, amountCents }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error ?? 'Could not start checkout.' };
    return { url: data.url };
  } catch {
    return { error: 'Network error — try again.' };
  }
}

// A "Pay $X" button that posts to Stripe Checkout and redirects on success.
// Renders the same fallback line everywhere payments are turned off, so
// members always understand why the button isn't there.
function PayButton({ kind, amountCents, label, enabled }: {
  kind: 'dues' | 'fines'; amountCents: number; label: string; enabled: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!enabled) {
    return (
      <div style={{ fontSize: 12.5, color: 'var(--ink-500)', textAlign: 'center', padding: '10px 0' }}>
        Online payments are currently off. Ask your treasurer how to pay.
      </div>
    );
  }

  const onClick = async () => {
    setLoading(true);
    setError(null);
    const { url, error: err } = await startCheckout(kind, amountCents);
    if (url) { window.location.href = url; return; }
    setError(err ?? 'Could not start checkout.');
    setLoading(false);
  };

  return (
    <>
      <button className="pkp-btn-primary" style={{ width: '100%', height: 46, fontSize: 14.5, opacity: loading ? 0.7 : 1 }} disabled={loading} onClick={onClick}>
        {loading ? 'Redirecting to Stripe…' : label}
      </button>
      {error && <div style={{ fontSize: 12.5, color: 'var(--pkp-primary)', marginTop: 8, textAlign: 'center' }}>{error}</div>}
    </>
  );
}

// Small banner for the ?paid=1 / ?canceled=1 redirect back from Stripe
// Checkout. The real balance update comes from the webhook + a page refresh
// (Stripe's redirect can beat the webhook by a second or two).
function CheckoutBanner() {
  const params = useSearchParams();
  const router = useRouter();
  const paid = params.get('paid');
  const canceled = params.get('canceled');
  if (!paid && !canceled) return null;
  return (
    <div className="pkp-card" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
      borderColor: paid ? 'var(--success-500)' : 'var(--cream-400)' }}>
      <span style={{ fontSize: 13.5, color: 'var(--ink-800)' }}>
        {paid ? 'Payment received — your balance updates within a few seconds.' : 'Checkout canceled — nothing was charged.'}
      </span>
      <button className="pkp-btn-ghost" style={{ height: 30, padding: '0 12px', fontSize: 12.5 }} onClick={() => router.replace('/finances')}>Dismiss</button>
    </div>
  );
}

// Ad-hoc charges/fines an exec adds this session (ephemeral; live = a write to
// the fines/charges table). Keyed by membershipId, layered on the derived fines.
type ExtraMap = Record<string, Fine[]>;
const unpaidExtra = (list: Fine[] | undefined) => (list ?? []).filter((f) => !f.paid).reduce((a, f) => a + f.amountCents, 0);

// Columns for the dues table (exec only). Overrides the default roster grid.
const FIN_GRID = '2.2fr 1.1fr 1.1fr 1.1fr 1fr 32px';

const Check = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export function FinancesScreen({ members, stats, settings, myMembershipId, live }: {
  members: MemberRow[]; stats: ChapterStats; settings: ChapterSettings;
  myMembershipId?: string | null; live?: boolean;
}) {
  const { role, persona } = useApp();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Suspense fallback={null}><CheckoutBanner /></Suspense>
      {role === 'member' ? (
        (() => {
          // Live: the real signed-in member (by membership id). Mock/demo: the
          // persona toggle's stand-in.
          const me = myMembershipId
            ? members.find((m) => m.membershipId === myMembershipId)
            : currentMember(members, persona);
          return me ? <MemberFinances member={me} settings={settings} live={live} /> : <p style={{ color: 'var(--ink-500)' }}>No dues on file.</p>;
        })()
      ) : (
        <ExecFinances members={members} stats={stats} settings={settings} />
      )}
    </div>
  );
}

/* ─────────────────────────── Shared: fines list ─────────────────────────── */

function FinesList({ fines, exec }: { fines: Fine[]; exec?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {fines.map((f, i) => (
        <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 11, padding: '11px 0', borderTop: i ? '1px solid var(--cream-200)' : 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: f.paid ? 'var(--success-500)' : 'var(--pkp-primary)' }} />
            <div>
              <div style={{ fontSize: 13, color: 'var(--ink-800)' }}>{f.label}</div>
              <div className="pkp-mono" style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 2 }}>{f.when}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="pkp-mono" style={{ fontSize: 13, fontWeight: 600, color: f.paid ? 'var(--ink-400)' : 'var(--pkp-primary)', textDecoration: f.paid ? 'line-through' : 'none' }}>{money(f.amountCents)}</span>
            {exec
              ? !f.paid && <button className="pkp-btn-ghost" style={{ height: 28, padding: '0 12px', fontSize: 12 }}>Waive</button>
              : f.paid ? <Badge tone="success">Paid</Badge> : <Badge tone="danger">Unpaid</Badge>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── Exec view ─────────────────────────── */

const CHIPS = [
  { id: 'all', label: 'All brothers' },
  { id: 'paid', label: 'Paid' },
  { id: 'partial', label: 'Partial' },
  { id: 'due', label: 'Overdue' },
] as const;
type Filter = (typeof CHIPS)[number]['id'];

// Treasurer/FO switch: turns the member-facing Stripe "Pay" buttons on/off.
// Off by default (stripe-dues.sql) since the receiving Stripe account often
// isn't linked yet when a new officer takes over each year — this lets the
// chapter keep using the app (and Zelle/manual payments) until it's ready,
// then flip payments on without a code change or deploy.
function PaymentSettingsCard({ settings }: { settings: ChapterSettings }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setPending(true);
    setError(null);
    const { error: err } = await getBrowserSupabase()
      .from('chapters')
      .update({ dues_payments_enabled: !settings.duesPaymentsEnabled })
      .eq('id', CHAPTER_ID);
    if (err) setError(err.message);
    else router.refresh();
    setPending(false);
  };

  return (
    <div className="pkp-card" style={{ padding: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-900)' }}>Online dues payments</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginTop: 3, maxWidth: 460 }}>
          {settings.duesPaymentsEnabled
            ? 'Brothers can pay dues and fines by card or bank transfer through Stripe.'
            : 'Turned off — brothers see "ask your treasurer" instead of a Pay button. Turn on once this year’s Stripe account is linked.'}
          {error && <span style={{ color: 'var(--pkp-primary)', display: 'block', marginTop: 4 }}>{error}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <Badge tone={settings.duesPaymentsEnabled ? 'success' : 'neutral'}>{settings.duesPaymentsEnabled ? 'On' : 'Off'}</Badge>
        <Switch on={settings.duesPaymentsEnabled} onClick={pending ? () => {} : toggle} />
      </div>
    </div>
  );
}

function ExecFinances({ members, stats, settings }: { members: MemberRow[]; stats: ChapterStats; settings: ChapterSettings }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<MemberRow | null>(null);
  const [extra, setExtra] = useState<ExtraMap>({});
  const [charging, setCharging] = useState<MemberRow | 'pick' | null>(null);

  const rows = filter === 'all' ? members : members.filter((m) => m.duesState === filter);
  const finesOf = (m: MemberRow) => finesOutstanding(m) + unpaidExtra(extra[m.membershipId]);
  const addCharge = (id: string, fine: Fine) => setExtra((x) => ({ ...x, [id]: [fine, ...(x[id] ?? [])] }));

  // Computed from the roster against the active quarter (+ fines) so the numbers
  // stay coherent with the quarter dues — not the seed's flat term figure.
  const collected = members.reduce((a, m) => a + duesFor(m).paid, 0);
  const duesTarget = currentDuesCents * members.length;
  const duesOutstanding = members.reduce((a, m) => a + duesFor(m).balance, 0);
  const finesOut = members.reduce((a, m) => a + finesOf(m), 0);
  const overdueCount = members.filter((m) => m.duesState === 'due').length;
  const collectedPct = Math.round((collected / duesTarget) * 100);

  const cards = [
    { val: money(collected), top: 'var(--success-500)', label: 'Collected', sub: `${collectedPct}% of ${money(duesTarget)}` },
    { val: money(duesOutstanding + finesOut), top: 'var(--warning-500)', label: 'Outstanding', sub: `${money(duesOutstanding)} dues · ${money(finesOut)} fines` },
    { val: money(finesOut), top: 'var(--pkp-primary)', label: 'Unpaid fines', sub: `${overdueCount} brothers past due on dues` },
  ];

  return (
    <>
      <PaymentSettingsCard settings={settings} />

      <StatCards cards={cards} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Chips options={CHIPS} value={filter} onChange={setFilter} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="pkp-btn-ghost" style={{ height: 40, padding: '0 16px', fontSize: 13.5 }}
            onClick={() => downloadCsv('cal-beta-finances.csv',
              ['Brother', 'Role', 'Dues balance', 'Fines', 'Total owed', 'Status'],
              members.map((m) => { const d = duesFor(m); const f = finesOf(m); return [m.fullName, m.roleLabel, (d.balance / 100).toFixed(2), (f / 100).toFixed(2), ((d.balance + f) / 100).toFixed(2), m.duesState]; }))}>
            Export
          </button>
          <AddButton label="Add charge" onClick={() => setCharging('pick')} />
        </div>
      </div>

      <div className="pkp-card" style={{ overflow: 'hidden' }}>
        <div className="pkp-table-head" style={{ gridTemplateColumns: FIN_GRID }}>
          <div className="pkp-col-head">Brother</div>
          <div className="pkp-col-head pkp-r">Dues bal.</div>
          <div className="pkp-col-head pkp-r">Fines</div>
          <div className="pkp-col-head pkp-r">Total owed</div>
          <div className="pkp-col-head">Status</div>
          <div />
        </div>
        {rows.map((m) => {
          const db = duesBadge(m.duesState);
          const dues = duesFor(m);
          const fines = finesOf(m);
          const total = dues.balance + fines;
          return (
            <div key={m.membershipId} className="pkp-row" style={{ gridTemplateColumns: FIN_GRID }} onClick={() => setSelected(m)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <Avatar name={m.fullName} size={36} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-900)' }}>{m.fullName}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>{m.roleLabel}</div>
                </div>
              </div>
              <div className="pkp-mono pkp-r" style={{ fontSize: 14, color: dues.balance > 0 ? 'var(--ink-800)' : 'var(--ink-400)' }}>{money(dues.balance)}</div>
              <div className="pkp-mono pkp-r" style={{ fontSize: 14, color: fines > 0 ? 'var(--ink-800)' : 'var(--ink-400)' }}>{money(fines)}</div>
              <div className="pkp-mono pkp-r" style={{ fontSize: 14, fontWeight: 600, color: total > 0 ? 'var(--pkp-primary)' : 'var(--ink-800)' }}>{money(total)}</div>
              <div><Badge tone={db.tone}>{db.label}</Badge></div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', color: 'var(--ink-400)' }}>{icons.chevron}</div>
            </div>
          );
        })}
      </div>

      {selected && (
        <FinanceDrawer
          member={selected}
          extra={extra[selected.membershipId] ?? []}
          onAddFine={() => setCharging(selected)}
          onClose={() => setSelected(null)}
        />
      )}
      {charging !== null && (
        <ChargeModal
          members={members}
          fixed={charging === 'pick' ? undefined : charging}
          onClose={() => setCharging(null)}
          onSave={(id, fine) => { addCharge(id, fine); setCharging(null); }}
        />
      )}
    </>
  );
}

function ChargeModal({ members, fixed, onClose, onSave }: {
  members: MemberRow[]; fixed?: MemberRow; onClose: () => void; onSave: (id: string, fine: Fine) => void;
}) {
  const [memberId, setMemberId] = useState(fixed?.membershipId ?? members[0]?.membershipId ?? '');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const cents = Math.round(parseFloat(amount) * 100);
  const canSave = label.trim() !== '' && cents > 0 && !!memberId;
  const submit = () => {
    if (!canSave) return;
    onSave(memberId, { id: `extra-${Date.now()}`, label: label.trim(), amountCents: cents, when: fmtDate(NOW.toISOString()), paid: false });
  };
  return (
    <Modal title={fixed ? 'Add fine' : 'Add charge'} sub={fixed ? fixed.fullName : 'Charge a brother'} onClose={onClose}
      footer={<ModalActions onCancel={onClose} onSave={submit} canSave={canSave} saveLabel={fixed ? 'Add fine' : 'Add charge'} />}>
      {!fixed && (
        <Select label="Brother" value={memberId} onChange={(e) => setMemberId(e.target.value)}
          options={members.map((m) => ({ value: m.membershipId, label: m.fullName }))} />
      )}
      <Field label="Description" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Late dues fee" />
      <Field label="Amount ($)" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25" />
    </Modal>
  );
}

function FinanceDrawer({ member: m, extra, onAddFine, onClose }: {
  member: MemberRow; extra: Fine[]; onAddFine: () => void; onClose: () => void;
}) {
  const db = duesBadge(m.duesState);
  const dues = duesFor(m);
  const ledger = quarterLedger(m);
  const fines = [...extra, ...finesFor(m)];
  const finesUnpaid = finesOutstanding(m) + unpaidExtra(extra);
  const owed = dues.balance + finesUnpaid;
  const card = (val: string, label: string, color: string) => (
    <MiniStat val={val} label={label} color={color} />
  );

  return (
    <Drawer
      onClose={onClose}
      header={<>
        <Avatar name={m.fullName} size={58} fontSize={20} />
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 21, fontWeight: 600, color: 'var(--ink-900)' }}>{m.fullName}</h2>
          <div style={{ fontSize: 13.5, color: 'var(--ink-500)', marginTop: 3 }}>{m.roleLabel} · {CURRENT_QUARTER_LABEL}</div>
          <div style={{ marginTop: 8 }}><Badge tone={db.tone}>{db.label}</Badge></div>
        </div>
      </>}
      footer={<>
        <a className="pkp-btn-primary"
          href={`mailto:${m.email}?subject=${encodeURIComponent('Phi Kappa Psi — dues reminder')}&body=${encodeURIComponent(`Hi ${m.fullName.split(' ')[0]},\n\nA reminder that you have an outstanding balance of ${money(owed)} for ${CURRENT_QUARTER_LABEL}. Please settle it before the next chapter meeting.\n\nThanks,\nTreasurer`)}`}
          style={{ flex: 1, height: 42, fontSize: 13.5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', pointerEvents: owed === 0 ? 'none' : 'auto', opacity: owed === 0 ? 0.5 : 1 }}>
          Send reminder
        </a>
        <button className="pkp-btn-ghost" style={{ flex: 1, height: 42, fontSize: 13.5 }} onClick={onAddFine}>Add fine</button>
      </>}
    >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            {card(money(dues.charged), 'Charged', 'var(--ink-900)')}
            {card(money(dues.paid), 'Paid', 'var(--success-600)')}
            {card(money(dues.balance), 'Balance', dues.balance > 0 ? 'var(--pkp-primary)' : 'var(--ink-900)')}
          </div>

          <div className="pkp-card" style={{ padding: 16 }}>
            <div className="pkp-col-head" style={{ marginBottom: 12 }}>Dues ledger</div>
            <Ledger entries={ledger} />
          </div>

          <div className="pkp-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="pkp-col-head">Fines</div>
              <span className="pkp-mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--pkp-primary)' }}>{money(finesUnpaid)} unpaid</span>
            </div>
            <FinesList fines={fines} exec />
          </div>
    </Drawer>
  );
}

function Ledger({ entries }: { entries: ReturnType<typeof quarterLedger> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {entries.map((e, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 11, padding: '10px 0', borderTop: i ? '1px solid var(--cream-200)' : 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: e.kind === 'payment' ? 'var(--success-500)' : 'var(--warning-500)' }} />
            <div>
              <div style={{ fontSize: 13, color: 'var(--ink-800)' }}>{e.label}</div>
              <div className="pkp-mono" style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 2 }}>{e.when}</div>
            </div>
          </div>
          <span className="pkp-mono" style={{ fontSize: 13, fontWeight: 600, color: e.kind === 'payment' ? 'var(--success-600)' : 'var(--ink-700)' }}>
            {e.kind === 'payment' ? '+' : ''}{money(e.amountCents)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── Member view ─────────────────────────── */

function MemberFinances({ member: m, settings, live }: { member: MemberRow; settings: ChapterSettings; live?: boolean }) {
  const db = duesBadge(m.duesState);
  // Live: real balances from member_finances (on the MemberRow). Mock/demo: the
  // quarter model. In live mode we deliberately show NO fines or invented
  // payment history — there's no fines table yet, and finesFor()/quarterLedger()
  // fabricate data off attendance/dues state, which would be wrong for a real member.
  const dues = live
    ? { charged: m.chargedCents, paid: m.paidCents, balance: m.balanceCents }
    : duesFor(m);
  const pct = dues.charged > 0 ? Math.min(100, Math.round((dues.paid / dues.charged) * 100)) : 0;
  const settled = dues.balance === 0;
  const ledger = live ? [] : quarterLedger(m);
  const fines = live ? [] : finesFor(m);
  const finesOut = live ? 0 : finesOutstanding(m);

  return (
    <div style={{ maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {settled ? (
        <PaidPill label="Dues paid in full" sub={CURRENT_QUARTER_LABEL} />
      ) : (
        <div className="pkp-card" style={{ padding: 26 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-500)' }}>Balance due</div>
              <div className="pkp-mono" style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.05, marginTop: 6, color: 'var(--pkp-primary)' }}>{money(dues.balance)}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 6 }}>{CURRENT_QUARTER_LABEL} · {money(dues.charged)} dues</div>
            </div>
            <Badge tone={db.tone}>{db.label}</Badge>
          </div>
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-500)', marginBottom: 6 }}>
              <span>{money(dues.paid)} paid</span><span>{money(dues.balance)} remaining</span>
            </div>
            <div style={{ height: 9, borderRadius: 999, background: 'var(--cream-300)', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 999, background: 'var(--pkp-primary)' }} />
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <PayButton kind="dues" amountCents={dues.balance} label={`Pay ${money(dues.balance)} dues`} enabled={settings.duesPaymentsEnabled} />
          </div>
        </div>
      )}

      <div className="pkp-card" style={{ padding: 16 }}>
        <div className="pkp-col-head" style={{ marginBottom: 12 }}>Payment history</div>
        <Ledger entries={ledger} />
      </div>

      <div className="pkp-card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: fines.length ? 12 : 0 }}>
          <div className="pkp-col-head">Fines</div>
          {finesOut > 0
            ? <span className="pkp-mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--pkp-primary)' }}>{money(finesOut)} unpaid</span>
            : <Badge tone="success">None outstanding</Badge>}
        </div>
        <FinesList fines={fines} />
        {finesOut > 0 && (
          <div style={{ marginTop: 14 }}>
            <PayButton kind="fines" amountCents={finesOut} label={`Pay ${money(finesOut)} in fines`} enabled={settings.duesPaymentsEnabled} />
          </div>
        )}
      </div>
    </div>
  );
}

function PaidPill({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="pkp-card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, borderColor: 'var(--success-500)', background: 'var(--success-100, #E8F3EC)' }}>
      <span style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--success-500)', color: '#fff' }}>{Check}</span>
      <div>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--success-600)' }}>{label}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginTop: 1 }}>{sub}</div>
      </div>
    </div>
  );
}

export { PaidPill };
