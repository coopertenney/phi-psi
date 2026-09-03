import { randomUUID } from 'crypto';
import type {
  Adjustment, BankStatus, BankTxn, DuesCharge, Exemption, MemberRow, NameAlias, PaymentRow,
  Snapshot, Term,
} from './types';
import type {
  ApplyCreditInput, DuesBackend, FeedApplyResult, FeedPageInput, OppFundInput, RecordCreditInput,
} from './backend';
import { buildRosterPlan, type RosterCsvRow } from './roster-csv';
import type { RosterImportResult } from './backend';
import { ROSTER } from './roster';
import { aliasToLearn } from './match';
import { buildLedger } from './ledger';
import { formatCents } from './money';
import { buildSampleCredits } from './sample';

// In-memory backend, used only when the Supabase env vars are absent (see
// lib/config.ts). Same convention as ../points-app/lib/mock-store.ts, with one
// addition: the state hangs off globalThis. Next compiles a separate server
// bundle per route in dev, so module-level state would give /settings its own
// empty copy of the ledger the desk just wrote to.

const ACTOR = 'Exec (mock)';

interface MockState {
  members: MemberRow[];
  terms: Term[];
  charges: DuesCharge[];
  txns: BankTxn[];
  payments: PaymentRow[];
  adjustments: Adjustment[];
  exemptions: Exemption[];
  aliases: NameAlias[];
}

function createState(): MockState {
  return {
    members: ROSTER.map((r, i) => ({
      id: `m${i + 1}`, name: r.name, aka: [], photoUrl: null, financialAid: false,
    })),
    terms: [{
      id: 'term1', label: 'Fall 2026', startsOn: '2026-09-22',
      createdAt: '2026-09-01T00:00:00.000Z',
      isCurrent: true, duesCents: null, autoApply: true,
    }],
    charges: [],
    txns: [],
    payments: [],
    adjustments: [],
    exemptions: [],
    aliases: [],
  };
}

const globalStore = globalThis as unknown as { __duesDeskMock?: MockState };
const state: MockState = (globalStore.__duesDeskMock ??= createState());

const currentTerm = () => state.terms.find((t) => t.isCurrent) ?? null;
const requireTerm = () => {
  const t = currentTerm();
  if (!t) throw new Error('No current term is set.');
  return t;
};
const requireTxn = (txnId: string) => {
  const t = state.txns.find((x) => x.id === txnId);
  if (!t) throw new Error('That credit no longer exists.');
  return t;
};

function chargeIdFor(memberId: string, termId: string): string | null {
  return state.charges.find((c) => c.memberId === memberId && c.termId === termId)?.id ?? null;
}

function snapshot(): Snapshot {
  return {
    members: [...state.members].sort((a, b) => a.name.localeCompare(b.name)),
    term: currentTerm(),
    terms: [...state.terms],
    charges: [...state.charges],
    txns: [...state.txns],
    payments: [...state.payments],
    adjustments: [...state.adjustments],
    exemptions: [...state.exemptions],
    aliases: [...state.aliases],
    actor: ACTOR,
  };
}

function learn(rawDescription: string, memberId: string) {
  const member = state.members.find((m) => m.id === memberId);
  if (!member) return;
  const bankName = aliasToLearn(rawDescription, member.name);
  if (!bankName) return;
  if (state.aliases.some((a) => a.bankName.toUpperCase() === bankName.toUpperCase())) return;
  state.aliases.push({
    id: randomUUID(), bankName, memberId, createdBy: ACTOR, createdAt: new Date().toISOString(),
  });
  member.aka = [...member.aka, bankName];
}

// The inverse of learn(): drop the alias this credit taught for this member, and
// the denormalized copy on the member row.
function unlearn(rawDescription: string, memberId: string) {
  const member = state.members.find((m) => m.id === memberId);
  if (!member) return;
  const bankName = aliasToLearn(rawDescription, member.name);
  if (!bankName) return;
  const key = bankName.toUpperCase();
  state.aliases = state.aliases.filter(
    (a) => !(a.memberId === memberId && a.bankName.toUpperCase() === key),
  );
  member.aka = member.aka.filter((a) => a.toUpperCase() !== key);
}

export const mockBackend: DuesBackend = {
  async getSnapshot() {
    return snapshot();
  },

  async getPublicLedger() {
    return buildLedger(snapshot()).map((r) => ({
      memberId: r.memberId,
      name: r.name,
      owedCents: r.owedCents,
      paidCents: r.paidCents,
      balanceCents: r.balanceCents,
      status: r.status,
    }));
  },

  async recordCredit(input: RecordCreditInput) {
    if (!input.rawDescription.trim()) throw new Error('The bank descriptor is required.');
    if (!input.amountCents) throw new Error('Amount must be a non-zero number.');
    state.txns.push({
      id: randomUUID(),
      providerTxnId: null,
      pendingTxnId: null,
      accountId: null,
      postedOn: input.postedOn,
      amountCents: input.amountCents,
      rawDescription: input.rawDescription.trim(),
      pending: input.pending,
      removedAt: null,
      amountChangedAt: null,
      source: 'manual',
      status: 'queued',
      enteredBy: ACTOR,
    });
  },

  async applyCredit(input: ApplyCreditInput) {
    const txn = requireTxn(input.txnId);
    const term = requireTerm();
    const total = input.allocations.reduce((a, x) => a + x.amountCents, 0);
    if (!input.allocations.length) throw new Error('Pick at least one brother.');
    // Cumulative, not per-call — same as the live backend. A per-call check lets
    // one credit be applied in full to two different brothers across two calls,
    // turning $450 of real money into $900 on the ledger.
    const alreadyApplied = state.payments
      .filter((p) => p.bankTxnId === txn.id)
      .reduce((a, p) => a + p.amountCents, 0);
    if (alreadyApplied + total !== txn.amountCents) {
      throw new Error(alreadyApplied
        ? `${formatCents(alreadyApplied)} of this credit is already applied — the rest has to add up to ${formatCents(txn.amountCents - alreadyApplied)}.`
        : 'The split has to add up to the credit exactly.');
    }
    const ids = input.allocations.map((a) => a.memberId);
    if (new Set(ids).size !== ids.length) throw new Error('Pick two different brothers.');
    // Mirrors the live unique (bank_txn_id, member_id) index: a double-submit
    // is refused rather than crediting the same brother twice for one credit.
    if (ids.some((id) => state.payments.some((p) => p.bankTxnId === txn.id && p.memberId === id))) {
      throw new Error('That credit is already applied to this brother.');
    }

    // One row per brother, stamped with the term the money was RECORDED in — not
    // the term it settles. Which term(s) it pays is derived in lib/ledger.ts,
    // oldest unpaid first, so a Fall payment arriving in January pays Fall.
    //
    // Resolving that here instead was the alternative, and it does not fit: a
    // credit large enough to cover two terms would need two payment rows for one
    // brother, and `unique (bank_txn_id, member_id)` forbids exactly that — for
    // good reason, since it is the constraint that stops one credit being applied
    // to the same brother twice. Deriving keeps one raw row per brother per
    // credit, and lets `undoPayment` and the bank's `removed` reversal stay
    // correct by simply changing what is in the pool.
    //
    // charge_id is left null for the same reason: a payment can span two terms'
    // charges, so it cannot honestly point at one.
    input.allocations.forEach((a) => {
      state.payments.push({
        id: randomUUID(),
        bankTxnId: txn.id,
        memberId: a.memberId,
        termId: term.id,
        chargeId: null,
        amountCents: a.amountCents,
        appliedBy: ACTOR,
        reason: input.reason,
        createdAt: new Date().toISOString(),
      });
    });
    if (input.learnAliasFor) learn(txn.rawDescription, input.learnAliasFor);
    txn.status = 'applied';
  },

  async setAside(txnId: string) {
    requireTxn(txnId).status = 'set_aside';
  },

  async reverseCredit(txnId: string, memberId: string) {
    const txn = requireTxn(txnId);
    if (txn.amountCents >= 0) throw new Error('Only a negative credit reverses a payment.');
    const term = requireTerm();
    state.payments.push({
      id: randomUUID(),
      bankTxnId: txn.id,
      memberId,
      termId: term.id,
      chargeId: null,
      // Negative: un-credits without deleting history. Which term loses the money
      // is derived — the waterfall drains the most recently filled term first, so
      // taking $537 back off a brother who owed Fall and Winter leaves him owing
      // exactly one term again, whichever one the money had filled.
      amountCents: txn.amountCents,
      appliedBy: ACTOR,
      reason: `Reversal of a returned credit (${txn.rawDescription}).`,
      createdAt: new Date().toISOString(),
    });
    txn.status = 'applied';
  },

  async undoPayment(paymentId: string) {
    const payment = state.payments.find((p) => p.id === paymentId);
    if (!payment) throw new Error('That payment no longer exists.');
    const txn = state.txns.find((t) => t.id === payment.bankTxnId);
    if (txn?.removedAt) {
      throw new Error('The bank took this credit back — its reversal is already recorded.');
    }
    state.payments = state.payments.filter((p) => p.id !== paymentId);

    // Unlearn what applying this credit taught. Without this, undoing a wrong
    // match leaves the alias behind and every later credit from that sender
    // matches the wrong brother at full confidence.
    if (txn) unlearn(txn.rawDescription, payment.memberId);

    // Requeue whenever the credit is no longer fully accounted for — not only
    // when the last payment is gone. Undoing one half of a split otherwise
    // strands the other half on no ledger and in no queue.
    const applied = state.payments
      .filter((p) => p.bankTxnId === payment.bankTxnId)
      .reduce((a, p) => a + p.amountCents, 0);
    if (txn && applied !== txn.amountCents) txn.status = 'queued';
  },

  async setTermDues(amountCents: number) {
    if (amountCents <= 0) throw new Error('Dues must be more than zero.');
    requireTerm().duesCents = amountCents;
  },

  async createTerm(label: string, duesCents: number | null, startsOn: string | null) {
    if (!label.trim()) throw new Error('Give the term a name, like "Winter 2027".');
    if (state.terms.some((t) => t.label.toLowerCase() === label.trim().toLowerCase())) {
      throw new Error(`There is already a term called "${label.trim()}".`);
    }
    // Only one term is ever current — mirrors the terms_one_current index.
    state.terms.forEach((t) => { t.isCurrent = false; });
    state.terms.unshift({
      id: randomUUID(), label: label.trim(), startsOn, createdAt: new Date().toISOString(),
      isCurrent: true, duesCents, autoApply: true,
    });
  },

  async setFinancialAid(memberIds: string[], enabled: boolean) {
    const wanted = new Set(memberIds);
    state.members.forEach((m) => {
      if (wanted.has(m.id)) m.financialAid = enabled;
    });
  },

  async importRoster(rows: RosterCsvRow[], mode: 'replace' | 'pledges'): Promise<RosterImportResult> {
    const plan = buildRosterPlan(rows, state.members, mode);

    // Everyone on the file who is already here keeps his id — and therefore his
    // payments, his charges and every sender name an exec has confirmed for him.
    plan.aidChanges.forEach((c) => {
      const m = state.members.find((x) => x.id === c.member.id);
      if (m) m.financialAid = c.financialAid;
    });

    plan.added.forEach((row) => {
      state.members.push({
        id: randomUUID(), name: row.name, aka: [], photoUrl: null,
        financialAid: row.financialAid,
      });
    });

    // A replace deletes. The live schema cascades, so the mock must cascade too
    // or the two backends disagree about what a replace costs.
    const removedIds = new Set(plan.removed.map((m) => m.id));
    if (removedIds.size) {
      state.members = state.members.filter((m) => !removedIds.has(m.id));
      state.payments = state.payments.filter((p) => !removedIds.has(p.memberId));
      state.charges = state.charges.filter((c) => !removedIds.has(c.memberId));
      state.adjustments = state.adjustments.filter((a) => !removedIds.has(a.memberId));
      state.exemptions = state.exemptions.filter((e) => !removedIds.has(e.memberId));
      state.aliases = state.aliases.filter((a) => !removedIds.has(a.memberId));
    }

    return {
      keptCount: plan.kept.length,
      addedCount: plan.added.length,
      removedCount: plan.removed.length,
      aidChangedCount: plan.aidChanges.length,
      removedNames: plan.removed.map((m) => m.name),
    };
  },

  async setExempt(memberId: string, reason: string) {
    const term = requireTerm();
    if (state.exemptions.some((e) => e.memberId === memberId && e.termId === term.id)) return;

    // An exemption is the absence of a charge, not a waived one — so if he was
    // already charged, that charge comes off. Unless money has landed against
    // it, in which case somebody has to decide what happens to the money.
    //
    // "Money has landed" is a DERIVED question now. It used to be
    // `payments.charge_id === charge.id`, which misses everything that matters
    // once a payment can span terms: a credit recorded in Fall that spilled into
    // Winter carries Fall's term id and no charge id at all, and deleting
    // Winter's charge under it would silently re-route his money to a later term.
    const charge = state.charges.find((c) => c.memberId === memberId && c.termId === term.id);
    if (charge) {
      const row = buildLedger(snapshot()).find((r) => r.memberId === memberId);
      const landed = row?.terms.find((t) => t.termId === term.id)?.paidCents ?? 0;
      if (landed > 0) {
        throw new Error(
          'A payment is already applied to this term for him. Undo it first, then mark him abroad.',
        );
      }
      state.charges = state.charges.filter((c) => c.id !== charge.id);
    }

    state.exemptions.push({
      id: randomUUID(), memberId, termId: term.id, reason: reason.trim(),
      createdBy: ACTOR, createdAt: new Date().toISOString(),
    });
  },

  async removeExempt(memberId: string) {
    const term = requireTerm();
    state.exemptions = state.exemptions.filter(
      (e) => !(e.memberId === memberId && e.termId === term.id),
    );
  },

  async issueCharges() {
    const term = requireTerm();
    if (!term.duesCents) throw new Error('Set the term dues amount first.');
    // Brothers who are abroad are skipped, not charged and then zeroed out.
    const exempt = new Set(
      state.exemptions.filter((e) => e.termId === term.id).map((e) => e.memberId),
    );
    const missing = state.members.filter((m) => !exempt.has(m.id) && !chargeIdFor(m.id, term.id));
    missing.forEach((m) => {
      state.charges.push({
        id: randomUUID(),
        memberId: m.id,
        termId: term.id,
        amountCents: term.duesCents!,
        description: `${term.label} dues`,
      });
    });
    return missing.length;
  },

  async grantOppFund(input: OppFundInput) {
    const term = requireTerm();
    if (input.amountCents <= 0) throw new Error('An opportunity fund grant must be more than zero.');
    state.adjustments.push({
      id: randomUUID(),
      memberId: input.memberId,
      termId: term.id,
      amountCents: input.amountCents,
      kind: 'opp_fund',
      reason: input.reason.trim(),
      createdBy: ACTOR,
      createdAt: new Date().toISOString(),
    });
  },

  async removeAdjustment(adjustmentId: string) {
    state.adjustments = state.adjustments.filter((a) => a.id !== adjustmentId);
  },

  async applyFeedPage(input: FeedPageInput): Promise<FeedApplyResult> {
    const term = requireTerm();
    const insertedTxnIds: string[] = [];
    const settledTxnIds: string[] = [];
    let modifiedCount = 0;
    let removedCount = 0;
    let reversedCount = 0;
    let ignoredRemovedCount = 0;

    // ---- added: promotions first, then genuinely new rows ----
    input.added.forEach((f) => {
      if (f.amountCents === 0) throw new Error('The feed produced a zero-amount credit.');

      // A posted transaction naming the pending one it replaces. Update in place:
      // the row keeps its id, so a payment an exec already applied to the pending
      // credit stays attached and the money is counted once. Inserting a second
      // row here is the single easiest way to double-count a dues payment.
      const promoted = f.pendingTxnId
        ? state.txns.find((t) => t.providerTxnId === f.pendingTxnId)
        : undefined;
      if (promoted) {
        if (promoted.status === 'applied' && promoted.amountCents !== f.amountCents) {
          promoted.amountChangedAt = new Date().toISOString();
        }
        promoted.pendingTxnId = f.pendingTxnId;
        promoted.providerTxnId = f.providerTxnId;
        promoted.postedOn = f.postedOn;
        promoted.amountCents = f.amountCents;
        promoted.rawDescription = f.rawDescription;
        promoted.pending = false;
        settledTxnIds.push(promoted.id);
        return;
      }

      // Re-syncing an overlapping window is normal; the provider id is unique.
      if (state.txns.some((t) => t.providerTxnId === f.providerTxnId)) return;

      const id = randomUUID();
      state.txns.push({
        id,
        providerTxnId: f.providerTxnId,
        pendingTxnId: f.pendingTxnId,
        accountId: f.accountId,
        postedOn: f.postedOn,
        amountCents: f.amountCents,
        rawDescription: f.rawDescription,
        pending: f.pending,
        removedAt: null,
        amountChangedAt: null,
        source: 'plaid',
        status: 'queued',
        enteredBy: input.actor,
      });
      insertedTxnIds.push(id);
    });

    // ---- modified: never touch status, id, or who entered it ----
    input.modified.forEach((f) => {
      const row = state.txns.find((t) => t.providerTxnId === f.providerTxnId);
      if (!row) return;   // dropped as a debit, wrong account, or before the floor
      // An amount that changes after the credit was applied breaks the invariant
      // applyCredit enforces (allocations sum exactly to the credit). Flag it for
      // a human rather than letting the ledger drift silently.
      if (row.status === 'applied' && row.amountCents !== f.amountCents) {
        row.amountChangedAt = new Date().toISOString();
      }
      row.postedOn = f.postedOn;
      row.amountCents = f.amountCents;
      row.rawDescription = f.rawDescription;
      row.pending = f.pending;
      modifiedCount++;
    });

    // ---- removed: the bank says it never happened ----
    input.removed.forEach((providerTxnId) => {
      // A pending row we already promoted. Its removal is bookkeeping, not a
      // reversal — checked FIRST, or promotion would immediately be undone.
      if (state.txns.some((t) => t.pendingTxnId === providerTxnId
        && t.providerTxnId !== providerTxnId)) {
        ignoredRemovedCount++;
        return;
      }
      const row = state.txns.find((t) => t.providerTxnId === providerTxnId);
      if (!row) { ignoredRemovedCount++; return; }

      removedCount++;
      row.removedAt = new Date().toISOString();

      // Branch on whether money was applied, NOT on status: a partially-undone
      // split sits at 'queued' with a live payment still on it.
      const applied0 = state.payments.filter((p) => p.bankTxnId === row.id);
      if (!applied0.length) { row.status = 'set_aside'; return; }

      // Reversal needs its own transaction to hang off: payments are unique on
      // (bank_txn_id, member_id), so a negative row cannot sit beside the
      // positive one it reverses. Mirror the credit, then mirror each payment —
      // per payment, so a credit split across two brothers reverses both halves.
      //
      // The mirror's provider id is deterministic and it is REUSED if it already
      // exists, exactly as the live backend's upsert does. The positive payments
      // stay on the original row after a reversal, so a feed that reports the
      // same removal twice — a replayed page, an overlapping cursor window —
      // walks straight back into this branch, and creating a second mirror would
      // reverse the same money again and drive the brother's balance past what
      // he was ever charged.
      const applied = applied0;
      const mirrorProviderId = `${providerTxnId}:removed`;
      const total = -applied.reduce((a, p) => a + p.amountCents, 0);
      let mirror = state.txns.find((t) => t.providerTxnId === mirrorProviderId);
      if (mirror) {
        mirror.amountCents = total;
      } else {
        mirror = {
          id: randomUUID(),
          providerTxnId: mirrorProviderId,
          pendingTxnId: null,
          accountId: row.accountId,
          postedOn: new Date().toISOString().slice(0, 10),
          amountCents: total,
          rawDescription: `REMOVED BY BANK — ${row.rawDescription}`,
          pending: false,
          removedAt: new Date().toISOString(),
          amountChangedAt: null,
          source: 'plaid',
          status: 'applied',      // never enters the queue
          enteredBy: input.actor,
        };
        state.txns.push(mirror);
      }
      const mirrorId = mirror.id;
      applied.forEach((p) => {
        // Mirrors the live upsert's `onConflict: 'bank_txn_id,member_id',
        // ignoreDuplicates: true`: a replayed removal reverses nothing new.
        if (state.payments.some((x) => x.bankTxnId === mirrorId && x.memberId === p.memberId)) {
          return;
        }
        state.payments.push({
          id: randomUUID(),
          bankTxnId: mirrorId,
          memberId: p.memberId,
          // The term the money was applied to, not whatever term is current.
          termId: p.termId,
          chargeId: p.chargeId,
          amountCents: -p.amountCents,
          appliedBy: input.actor,
          reason: `The bank reported this credit removed. Reversing ${formatCents(p.amountCents)}.`,
          createdAt: new Date().toISOString(),
        });
        reversedCount++;
      });
    });

    return {
      insertedTxnIds, settledTxnIds, modifiedCount, removedCount, reversedCount,
      ignoredRemovedCount,
    };
  },

  async getBankStatus(): Promise<BankStatus> {
    // Reads the mock sync store rather than a copy, so /bank shows what the
    // harness and the dev server actually did.
    const { mockSyncState } = await import('./bank/mock-sync-store');
    return {
      connected: mockSyncState.connected,
      institutionName: 'Stanford Federal Credit Union (mock)',
      accountName: 'Chapter Checking',
      accountMask: '1234',
      accountSelected: Boolean(mockSyncState.accountId),
      connectedAt: '2026-10-01T00:00:00.000Z',
      lastSyncedAt: mockSyncState.lastSyncedAt,
      needsReauth: mockSyncState.needsReauth,
      lastError: mockSyncState.lastError,
      runs: mockSyncState.runs.slice(0, 10),
    };
  },

  async setAutoApply(enabled: boolean) {
    requireTerm().autoApply = enabled;
  },

  async loadSampleCredits() {
    const term = requireTerm();
    if (!term.duesCents) term.duesCents = 45000;
    await mockBackend.issueCharges();

    const sorted = [...state.members].sort((a, b) => a.name.localeCompare(b.name));
    const sample = buildSampleCredits(sorted, term.duesCents, '2026-10-03');

    // The reversal case only means anything against a payment that was already
    // applied, so settle that brother first.
    if (sample.returnedMemberId) {
      state.payments.push({
        id: randomUUID(),
        bankTxnId: 'seed',
        memberId: sample.returnedMemberId,
        termId: term.id,
        chargeId: null,
        amountCents: term.duesCents,
        appliedBy: ACTOR,
        reason: 'Seeded walkthrough payment.',
        createdAt: new Date().toISOString(),
      });
    }

    sample.credits.forEach((c) => {
      state.txns.push({
        id: randomUUID(),
        providerTxnId: null,
        pendingTxnId: null,
        accountId: null,
        postedOn: c.postedOn,
        amountCents: c.amountCents,
        rawDescription: c.rawDescription,
        pending: c.pending,
        removedAt: null,
        amountChangedAt: null,
        source: 'manual',
        status: 'queued',
        enteredBy: 'Walkthrough',
      });
    });
  },
};
