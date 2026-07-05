'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { MemberRow, ChapterStats } from '@/lib/types';
import type { ChapterSettings } from '@/lib/data';
import type { RecentPayment } from '@/lib/data/payments';
import { money, duesBadge, fmtDate } from '@/lib/format';
import {
  currentDuesCents, duesFor, quarterLedger,
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

const Check = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export function FinancesScreen({ members, stats, settings, myMembershipId, recentPayments = [], live }: {
  members: MemberRow[]; stats: ChapterStats; settings: ChapterSettings;
  myMembershipId?: string | null; recentPayments?: RecentPayment[]; live?: boolean;
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
        <ExecFinances members={members} stats={stats} settings={settings} recentPayments={recentPayments} live={live} />
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

function ExecFinances({ members, stats, settings, recentPayments, live }: { members: MemberRow[]; stats: ChapterStats; settings: ChapterSettings; recentPayments: RecentPayment[]; live?: boolean }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<MemberRow | null>(null);
  const [extra, setExtra] = useState<ExtraMap>({});
  const [charging, setCharging] = useState<MemberRow | 'pick' | null>(null);

  const rows = filter === 'all' ? members : members.filter((m) => m.duesState === filter);
  // Live: real balances from member_finances (on the MemberRow). Mock/demo: the
  // quarter model. In live mode there's no fines table yet, so a member's fines
  // are only the ephemeral charges an exec adds this session — not the
  // fabricated standings fines finesFor()/finesOutstanding() invent off attendance.
  const duesOf = (m: MemberRow) => live
    ? { charged: m.chargedCents, paid: m.paidCents, balance: m.balanceCents }
    : duesFor(m);
  const finesOf = (m: MemberRow) => (live ? 0 : finesOutstanding(m)) + unpaidExtra(extra[m.membershipId]);
  const addCharge = (id: string, fine: Fine) => setExtra((x) => ({ ...x, [id]: [fine, ...(x[id] ?? [])] }));

  // Cards. Live: the real chapter_stats aggregates (collected/target + the
  // paid/partial/due split). Mock/demo: computed from the roster against the
  // active quarter so the numbers stay coherent with the quarter dues.
  const collected = live ? stats.collectedCents : members.reduce((a, m) => a + duesFor(m).paid, 0);
  const duesTarget = live ? stats.targetCents : currentDuesCents * members.length;
  const duesOutstanding = live ? Math.max(0, stats.targetCents - stats.collectedCents) : members.reduce((a, m) => a + duesFor(m).balance, 0);
  const finesOut = members.reduce((a, m) => a + finesOf(m), 0);
  const overdueCount = live ? stats.dueCount : members.filter((m) => m.duesState === 'due').length;
  const collectedPct = duesTarget > 0 ? Math.round((collected / duesTarget) * 100) : 0;

  const cards = live
    ? [
        { val: money(collected), top: 'var(--success-500)', label: 'Collected', sub: `${collectedPct}% of ${money(duesTarget)}` },
        { val: money(duesOutstanding), top: 'var(--warning-500)', label: 'Outstanding', sub: 'dues owed this term' },
        { val: String(overdueCount), top: 'var(--pkp-primary)', label: 'Overdue', sub: `${stats.paidCount} paid · ${stats.partialCount} partial` },
      ]
    : [
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
              live
                ? ['Brother', 'Role', 'Charged', 'Paid', 'Balance', 'Status']
                : ['Brother', 'Role', 'Dues balance', 'Fines', 'Total owed', 'Status'],
              members.map((m) => {
                const d = duesOf(m);
                if (live) return [m.fullName, m.roleLabel, (d.charged / 100).toFixed(2), (d.paid / 100).toFixed(2), (d.balance / 100).toFixed(2), m.duesState];
                const f = finesOf(m);
                return [m.fullName, m.roleLabel, (d.balance / 100).toFixed(2), (f / 100).toFixed(2), ((d.balance + f) / 100).toFixed(2), m.duesState];
              }))}>
            Export
          </button>
          <AddButton label="Add charge" onClick={() => setCharging('pick')} />
        </div>
      </div>

      <div className="pkp-card pkp-fin-table" style={{ overflow: 'hidden' }}>
        <div className="pkp-table-head">
          <div className="pkp-col-head">Brother</div>
          {/* Live: Charged / Paid / Balance from member_finances. Mock/demo: the
              quarter model's balance + fabricated fines + total owed. Column 4
              stays the key figure (Balance / Total owed) — it's the one the
              mobile list keeps. */}
          <div className="pkp-col-head pkp-r">{live ? 'Charged' : 'Dues bal.'}</div>
          <div className="pkp-col-head pkp-r">{live ? 'Paid' : 'Fines'}</div>
          <div className="pkp-col-head pkp-r">{live ? 'Balance' : 'Total owed'}</div>
          <div className="pkp-col-head">Status</div>
          <div />
        </div>
        {rows.map((m) => {
          const db = duesBadge(m.duesState);
          const dues = duesOf(m);
          const fines = finesOf(m);
          // Column 2/3/4: live = Charged / Paid / Balance; mock = Balance / Fines / Total owed.
          const col2 = live ? dues.charged : dues.balance;
          const col3 = live ? dues.paid : fines;
          const col4 = live ? dues.balance : dues.balance + fines;
          return (
            <div key={m.membershipId} className="pkp-row" onClick={() => setSelected(m)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <Avatar name={m.fullName} size={36} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-900)' }}>{m.fullName}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>{m.roleLabel}</div>
                </div>
              </div>
              <div className="pkp-mono pkp-r" style={{ fontSize: 14, color: col2 > 0 ? 'var(--ink-800)' : 'var(--ink-400)' }}>{money(col2)}</div>
              <div className="pkp-mono pkp-r" style={{ fontSize: 14, color: col3 > 0 ? 'var(--ink-800)' : 'var(--ink-400)' }}>{money(col3)}</div>
              <div className="pkp-mono pkp-r" style={{ fontSize: 14, fontWeight: 600, color: col4 > 0 ? 'var(--pkp-primary)' : 'var(--ink-800)' }}>{money(col4)}</div>
              <div><Badge tone={db.tone}>{db.label}</Badge></div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', color: 'var(--ink-400)' }}>{icons.chevron}</div>
            </div>
          );
        })}
      </div>

      {/* Recent payments — a glanceable activity log of dues coming in, so the
          treasurer can confirm money is landing without opening each member. */}
      <div className="pkp-card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '15px 22px', borderBottom: '1px solid var(--cream-300)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="pkp-h3" style={{ fontSize: 16 }}>Recent payments</h3>
          {recentPayments.length > 0 && (
            <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>Last {recentPayments.length}</span>
          )}
        </div>
        {recentPayments.length === 0 ? (
          <div style={{ padding: '18px 22px', fontSize: 13, color: 'var(--ink-500)' }}>No payments recorded yet.</div>
        ) : (
          recentPayments.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 22px', borderBottom: i < recentPayments.length - 1 ? '1px solid var(--cream-200)' : 'none' }}>
              <Avatar name={p.memberName} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.memberName}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>Dues payment · {fmtDate(p.paidAt)}</div>
              </div>
              <span className="pkp-mono" style={{ fontSize: 14, fontWeight: 600, color: 'var(--success-600)', flexShrink: 0 }}>+{money(p.amountCents)}</span>
            </div>
          ))
        )}
      </div>

      {selected && (
        <FinanceDrawer
          member={selected}
          extra={extra[selected.membershipId] ?? []}
          live={live}
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

function FinanceDrawer({ member: m, extra, live, onAddFine, onClose }: {
  member: MemberRow; extra: Fine[]; live?: boolean; onAddFine: () => void; onClose: () => void;
}) {
  const { termLabel } = useApp();
  const db = duesBadge(m.duesState);
  // Live: real member_finances balances, no invented ledger, and only the
  // ephemeral charges an exec adds this session (no fabricated standings fines).
  const dues = live
    ? { charged: m.chargedCents, paid: m.paidCents, balance: m.balanceCents }
    : duesFor(m);
  const ledger = live ? [] : quarterLedger(m);
  const fines = live ? [...extra] : [...extra, ...finesFor(m)];
  const finesUnpaid = (live ? 0 : finesOutstanding(m)) + unpaidExtra(extra);
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
          <div style={{ fontSize: 13.5, color: 'var(--ink-500)', marginTop: 3 }}>{m.roleLabel} · {termLabel}</div>
          <div style={{ marginTop: 8 }}><Badge tone={db.tone}>{db.label}</Badge></div>
        </div>
      </>}
      footer={<>
        <a className="pkp-btn-primary"
          href={`mailto:${m.email}?subject=${encodeURIComponent('Phi Kappa Psi — dues reminder')}&body=${encodeURIComponent(`Hi ${m.fullName.split(' ')[0]},\n\nA reminder that you have an outstanding balance of ${money(owed)} for ${termLabel}. Please settle it before the next chapter meeting.\n\nThanks,\nTreasurer`)}`}
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
            {ledger.length
              ? <Ledger entries={ledger} />
              : <div style={{ fontSize: 12.5, color: 'var(--ink-400)' }}>No payments recorded yet.</div>}
          </div>

          <div className="pkp-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: fines.length ? 12 : 0 }}>
              <div className="pkp-col-head">Fines</div>
              {finesUnpaid > 0
                ? <span className="pkp-mono" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--pkp-primary)' }}>{money(finesUnpaid)} unpaid</span>
                : <Badge tone="success">None outstanding</Badge>}
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
  const { termLabel } = useApp();
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
        <PaidPill label="Dues paid in full" sub={termLabel} />
      ) : (
        <div className="pkp-card" style={{ padding: 26 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-500)' }}>Balance due</div>
              <div className="pkp-mono" style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.05, marginTop: 6, color: 'var(--pkp-primary)' }}>{money(dues.balance)}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 6 }}>{termLabel} · {money(dues.charged)} dues</div>
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
