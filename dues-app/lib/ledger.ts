// Derives every number the desk shows from raw rows. No stored totals: a
// balance is charges − opportunity-fund adjustments − applied payments, always
// recomputed, so a reversed payment can never leave a stale total behind.

import { rankCredit } from './match';
import type { DeskSummary, LedgerRow, LedgerStatus, QueueItem, Snapshot } from './types';

function statusFor(charged: number, owed: number, paid: number): LedgerStatus {
  if (charged === 0) return 'unbilled';
  if (paid >= owed) return 'paid';
  return paid > 0 ? 'partial' : 'unpaid';
}

export function buildLedger(snap: Snapshot): LedgerRow[] {
  const termId = snap.term?.id ?? null;

  const charged = new Map<string, number>();
  snap.charges
    .filter((c) => !termId || c.termId === termId)
    .forEach((c) => charged.set(c.memberId, (charged.get(c.memberId) ?? 0) + c.amountCents));

  const oppFund = new Map<string, number>();
  snap.adjustments
    .filter((a) => !termId || a.termId === termId)
    .forEach((a) => oppFund.set(a.memberId, (oppFund.get(a.memberId) ?? 0) + a.amountCents));

  // Payments carry their own sign: a reversal is a negative payment row, so
  // summing them un-credits a returned transaction without deleting history.
  const paid = new Map<string, number>();
  snap.payments.forEach((p) => paid.set(p.memberId, (paid.get(p.memberId) ?? 0) + p.amountCents));

  return snap.members.map((m) => {
    const chargedCents = charged.get(m.id) ?? 0;
    const oppFundCents = Math.min(oppFund.get(m.id) ?? 0, chargedCents);
    const paidCents = paid.get(m.id) ?? 0;
    const owedCents = chargedCents - oppFundCents;
    return {
      memberId: m.id,
      name: m.name,
      aka: m.aka,
      chargedCents,
      oppFundCents,
      paidCents,
      owedCents,
      balanceCents: owedCents - paidCents,
      status: statusFor(chargedCents, owedCents, paidCents),
    };
  });
}

export function outstandingByMember(rows: LedgerRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  rows.forEach((r) => { out[r.memberId] = Math.max(0, r.balanceCents); });
  return out;
}

export function buildQueue(snap: Snapshot, rows: LedgerRow[]): QueueItem[] {
  const outstanding = outstandingByMember(rows);
  return snap.txns
    .filter((t) => t.status === 'queued')
    .sort((a, b) => (a.postedOn === b.postedOn ? a.id.localeCompare(b.id) : a.postedOn < b.postedOn ? -1 : 1))
    .map((txn) => rankCredit({
      txn,
      members: snap.members,
      aliases: snap.aliases,
      outstandingByMember: outstanding,
      duesCents: snap.term?.duesCents ?? null,
    }));
}

export function buildSummary(snap: Snapshot, rows: LedgerRow[], queue: QueueItem[]): DeskSummary {
  const chargedCents = rows.reduce((a, r) => a + r.chargedCents, 0);
  const oppFundCents = rows.reduce((a, r) => a + r.oppFundCents, 0);
  const collectedCents = rows.reduce((a, r) => a + r.paidCents, 0);
  const outstandingCents = rows.reduce((a, r) => a + Math.max(0, r.balanceCents), 0);
  // Members with nothing charged aren't "settled" — they're just not billed yet.
  const settledCount = rows.filter((r) => r.owedCents > 0 && r.balanceCents <= 0).length;
  return {
    collectedCents,
    chargedCents,
    oppFundCents,
    outstandingCents,
    memberCount: rows.length,
    settledCount,
    queueCount: queue.length,
    setAsideCount: snap.txns.filter((t) => t.status === 'set_aside').length,
  };
}

export interface DeskView {
  rows: LedgerRow[];
  queue: QueueItem[];
  summary: DeskSummary;
}

export function buildDesk(snap: Snapshot): DeskView {
  const rows = buildLedger(snap);
  const queue = buildQueue(snap, rows);
  return { rows, queue, summary: buildSummary(snap, rows, queue) };
}
