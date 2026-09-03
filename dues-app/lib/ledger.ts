// Derives every number the desk shows from raw rows. No stored totals: a
// balance is charges − opportunity-fund adjustments − applied payments, always
// recomputed, so a reversed payment can never leave a stale total behind.
//
// ─────────────────────────── the payment waterfall ───────────────────────────
//
// The chapter runs three terms a year at different prices and a brother can owe
// two of them at once. A payment settles his OLDEST UNPAID TERM FIRST and spills
// forward into later terms if it is large enough: owing Fall $537 and Winter
// $537, $1074 squares both and $700 clears Fall and puts $163 on Winter.
//
// **The allocation is derived here, at read time, and never stored.** That is
// not just the house rule ("raw facts, derived numbers") — for this particular
// number it is the only option that stays correct, for three reasons:
//
//   1. A stored allocation is a stored total wearing a different hat. Which term
//      a payment settles depends on every OTHER payment, every charge, every
//      opportunity-fund grant and every exemption the brother has. Add an
//      exemption in March and a payment recorded in October has to move. Stored,
//      it would silently not move.
//   2. `undoPayment` deletes a row. Under derivation the remaining payments
//      simply re-waterfall and every term is right again. Stored, deleting the
//      first of three payments would leave the other two pointing at terms they
//      no longer fill, and nothing in the system would notice.
//   3. `payments` is `unique (bank_txn_id, member_id)`. A credit that spills
//      across two terms CANNOT be written as two payment rows for one brother —
//      the constraint forbids it, and it exists for a good reason (it is the
//      idempotency point that stops one credit being applied to the same brother
//      twice). Storing the spill would mean either violating that guarantee or
//      inventing an allocations side-table whose rows are, again, derived
//      numbers that can go stale. So the representation is: **the payment row
//      stays one raw fact — "$700 arrived from this brother" — and the split
//      across Fall and Winter is computed, never written.**
//
// The bank's `removed` reversal is a negative payment row on a mirror txn, which
// under derivation is simply money leaving the pool; the waterfall re-runs and
// every term lands correctly without anything having to know which term the
// original had filled.

import { rankCredit } from './match';
import type {
  DeskSummary, LedgerRow, LedgerStatus, LedgerTermRow, MemberBalance, QueueItem,
  Snapshot, Term,
} from './types';

export type { MemberBalance };

function statusFor(charged: number, owed: number, paid: number, exempt: boolean): LedgerStatus {
  // Exempt outranks everything: a brother who is abroad and sent nothing must
  // never read as 'unpaid' on a follow-up list, and never as 'paid' either.
  if (exempt && charged === 0) return 'exempt';
  if (charged === 0) return 'unbilled';
  if (paid >= owed) return 'paid';
  return paid > 0 ? 'partial' : 'unpaid';
}

// A term nobody dated sorts last. It cannot claim to be older than one that says
// when it started, and `createTerm` is the only way to make a term, so an undated
// one is almost always the one just created. `createdAt` then breaks ties among
// undated terms, and the id breaks a tie between two written in the same
// millisecond — the order has to be total, because the whole waterfall depends
// on knowing which term is older.
const UNDATED = '9999-12-31';

export function termsOldestFirst(terms: Term[]): Term[] {
  return [...terms].sort((a, b) => {
    const as = a.startsOn ?? UNDATED;
    const bs = b.startsOn ?? UNDATED;
    if (as !== bs) return as < bs ? -1 : 1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Pour one brother's money into his terms, oldest first.
 *
 * `owed` is his per-term obligation in term order and `netPaid` is the sum of
 * every payment row he has — positives and the negatives a reversal writes. The
 * return is how much landed on each term, plus whatever spilled past the last
 * one as overpayment.
 *
 * Deliberately takes the NET, not the individual payments in sequence. An
 * earlier version poured them one at a time and drained reversals newest-term
 * first, which is the same answer *if* the rows are ordered — and payment rows
 * are not reliably ordered. `payments.created_at` has millisecond resolution and
 * the bank's `removed` reversal is written in the same instant as the credit it
 * reverses, so the negative could sort ahead of its own positive; the negative
 * then drained nothing, the positive filled the term afterwards, and the brother
 * read as paid for money the bank had taken back. It failed about one run in
 * five. Netting first makes the order impossible to depend on.
 */
function allocate(owed: number[], netPaid: number): { filled: number[]; overpaid: number } {
  const filled = owed.map(() => 0);
  // A net-negative pool — only reachable if a reversal were somehow recorded
  // twice — allocates nothing rather than making a term owe more than it charged.
  let left = Math.max(0, netPaid);
  for (let i = 0; i < owed.length && left > 0; i++) {
    const take = Math.min(Math.max(0, owed[i]), left);
    filled[i] = take;
    left -= take;
  }
  return { filled, overpaid: netPaid - filled.reduce((a, b) => a + b, 0) };
}

export function buildLedger(snap: Snapshot): LedgerRow[] {
  const terms = termsOldestFirst(snap.terms);
  const currentId = snap.term?.id ?? null;

  // Composite map key. Separated by a NUL, which cannot occur in a uuid or in the
  // mock store's ids, so no two (member, term) pairs can collide by concatenation.
  const key = (memberId: string, termId: string) => `${memberId}\u0000${termId}`;

  const charged = new Map<string, number>();
  snap.charges.forEach((c) => {
    const k = key(c.memberId, c.termId);
    charged.set(k, (charged.get(k) ?? 0) + c.amountCents);
  });

  const oppFund = new Map<string, number>();
  snap.adjustments.forEach((a) => {
    const k = key(a.memberId, a.termId);
    oppFund.set(k, (oppFund.get(k) ?? 0) + a.amountCents);
  });

  const exempt = new Set(snap.exemptions.map((e) => key(e.memberId, e.termId)));

  // Payments carry their own sign: a reversal is a negative payment row, so
  // summing them un-credits a returned transaction without deleting history.
  // Deliberately NOT grouped by term — `payments.term_id` records the term the
  // money was recorded in, not the term it settles, and the waterfall below is
  // what decides where it lands.
  const netPaid = new Map<string, number>();
  snap.payments.forEach((p) => {
    netPaid.set(p.memberId, (netPaid.get(p.memberId) ?? 0) + p.amountCents);
  });

  return snap.members.map((m) => {
    // Only terms he has a stake in: charged, or explicitly exempted from. A term
    // that predates him on the roster is not his problem and must not show up as
    // a $0 line on his ledger.
    const mine = terms.filter((t) => charged.has(key(m.id, t.id)) || exempt.has(key(m.id, t.id)));

    const owedPerTerm = mine.map((t) => {
      const c = charged.get(key(m.id, t.id)) ?? 0;
      // Capped at the charge: an over-granted opportunity fund must not make the
      // amount owed negative and hand him credit against a different term.
      const opp = Math.min(oppFund.get(key(m.id, t.id)) ?? 0, c);
      return { charged: c, opp, owed: c - opp };
    });

    // The raw fact: net money received from him, across every term. Not the sum
    // of the per-term allocations below, which stop at what he owed — the two
    // differ by `overpaid`.
    const paidCents = netPaid.get(m.id) ?? 0;
    const { filled, overpaid } = allocate(owedPerTerm.map((o) => o.owed), paidCents);

    const termRows: LedgerTermRow[] = mine.map((t, i) => {
      const o = owedPerTerm[i];
      const isExempt = exempt.has(key(m.id, t.id));
      return {
        termId: t.id,
        termLabel: t.label,
        isCurrent: t.id === currentId,
        exempt: isExempt,
        chargedCents: o.charged,
        oppFundCents: o.opp,
        owedCents: o.owed,
        paidCents: filled[i],
        balanceCents: Math.max(0, o.owed - filled[i]),
        status: statusFor(o.charged, o.owed, filled[i], isExempt),
      };
    });

    const chargedCents = owedPerTerm.reduce((a, o) => a + o.charged, 0);
    const oppFundCents = owedPerTerm.reduce((a, o) => a + o.opp, 0);
    const owedCents = owedPerTerm.reduce((a, o) => a + o.owed, 0);
    const balanceCents = termRows.reduce((a, r) => a + r.balanceCents, 0);

    const open = termRows.filter((r) => r.balanceCents > 0);
    const settlingAmounts: number[] = [];
    open.reduce((running, r) => {
      const next = running + r.balanceCents;
      settlingAmounts.push(next);
      return next;
    }, 0);

    const currentExempt = currentId ? exempt.has(key(m.id, currentId)) : false;

    return {
      memberId: m.id,
      name: m.name,
      aka: m.aka,
      financialAid: m.financialAid,
      exempt: currentExempt,
      chargedCents,
      oppFundCents,
      paidCents,
      owedCents,
      // "Balance" always means what is still owed, so it never goes negative.
      // Money past that is reported separately as overpaid — a flag to look at,
      // and it will be absorbed by the next term's charge only because the whole
      // waterfall is re-derived, never because anything carried it forward.
      balanceCents,
      overpaidCents: Math.max(0, overpaid),
      status: statusFor(chargedCents, owedCents, Math.min(paidCents, owedCents), currentExempt),
      terms: termRows,
      current: termRows.find((r) => r.isCurrent) ?? null,
      oldestUnpaidTermId: open[0]?.termId ?? null,
      oldestUnpaidCents: open[0]?.balanceCents ?? 0,
      settlingAmounts,
    };
  });
}

/**
 * What the matcher needs to know about every brother's money. The shape itself
 * lives in lib/types.ts, so lib/match.ts can name it without a circular import.
 */
export function balancesByMember(rows: LedgerRow[]): Record<string, MemberBalance> {
  const out: Record<string, MemberBalance> = {};
  rows.forEach((r) => {
    const oldest = r.terms.find((t) => t.termId === r.oldestUnpaidTermId) ?? null;
    out[r.memberId] = {
      totalCents: Math.max(0, r.balanceCents),
      oldestCents: r.oldestUnpaidCents,
      oldestTermLabel: oldest?.termLabel ?? null,
      settlingAmounts: r.settlingAmounts,
      openTermCount: r.terms.filter((t) => t.balanceCents > 0).length,
    };
  });
  return out;
}

/** Every distinct per-brother term charge on the books. Split detection ("this
 *  is exactly 2× the dues, so it probably covers two brothers") has to look at
 *  all of them now that Fall costs $537 and Spring costs $300 — checking only
 *  the current term would miss a doubled Fall payment arriving in Spring. */
export function duesOptions(snap: Snapshot): number[] {
  const seen = new Set<number>();
  snap.terms.forEach((t) => { if (t.duesCents && t.duesCents > 0) seen.add(t.duesCents); });
  snap.charges.forEach((c) => { if (c.amountCents > 0) seen.add(c.amountCents); });
  return [...seen].sort((a, b) => a - b);
}

export function buildQueue(snap: Snapshot, rows: LedgerRow[]): QueueItem[] {
  const balances = balancesByMember(rows);
  const options = duesOptions(snap);
  return snap.txns
    .filter((t) => t.status === 'queued' && !t.removedAt)
    .sort((a, b) => (a.postedOn === b.postedOn ? a.id.localeCompare(b.id) : a.postedOn < b.postedOn ? -1 : 1))
    .map((txn) => rankCredit({
      txn,
      members: snap.members,
      aliases: snap.aliases,
      balances,
      duesCents: snap.term?.duesCents ?? null,
      duesOptions: options,
    }));
}

export function buildSummary(snap: Snapshot, rows: LedgerRow[], queue: QueueItem[]): DeskSummary {
  // Current term — "how is this term going". See the DeskSummary doc comment for
  // why these three stayed term-scoped while outstanding did not.
  const chargedCents = rows.reduce((a, r) => a + (r.current?.chargedCents ?? 0), 0);
  const oppFundCents = rows.reduce((a, r) => a + (r.current?.oppFundCents ?? 0), 0);
  const collectedCents = rows.reduce((a, r) => a + (r.current?.paidCents ?? 0), 0);

  // Every term — the chapter's actual receivable. Scoping this to the current
  // term is the bug: a Fall debt vanished the moment Winter became current.
  const outstandingCents = rows.reduce((a, r) => a + r.balanceCents, 0);
  const outstandingThisTermCents = rows.reduce((a, r) => a + (r.current?.balanceCents ?? 0), 0);
  const priorOutstandingCents = outstandingCents - outstandingThisTermCents;
  const priorOwingCount = rows.filter(
    (r) => r.balanceCents - (r.current?.balanceCents ?? 0) > 0,
  ).length;

  // Members with nothing charged aren't "settled" — they're just not billed yet.
  const settledCount = rows.filter((r) => r.owedCents > 0 && r.balanceCents <= 0).length;
  // Who to actually chase: owes money on ANY term and isn't already known to be
  // on aid. The old rule also excluded anyone exempt, which was wrong once terms
  // could overlap — a brother abroad this quarter can still owe last quarter.
  // Exempt-everywhere brothers owe nothing, so they fall out on the balance test.
  const followUpCount = rows.filter((r) => r.balanceCents > 0 && !r.financialAid).length;
  const aidCount = rows.filter((r) => r.financialAid).length;
  const exemptCount = rows.filter((r) => r.exempt).length;
  return {
    collectedCents,
    chargedCents,
    oppFundCents,
    outstandingCents,
    outstandingThisTermCents,
    priorOutstandingCents,
    priorOwingCount,
    memberCount: rows.length,
    settledCount,
    queueCount: queue.length,
    setAsideCount: snap.txns.filter((t) => t.status === 'set_aside').length,
    followUpCount,
    aidCount,
    exemptCount,
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
