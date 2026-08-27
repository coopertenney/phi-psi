import { randomUUID } from 'crypto';
import type {
  Adjustment, BankTxn, DuesCharge, MemberRow, NameAlias, PaymentRow, Snapshot, Term,
} from './types';
import type { ApplyCreditInput, DuesBackend, OppFundInput, RecordCreditInput } from './backend';
import { ROSTER } from './roster';
import { aliasToLearn } from './match';
import { buildLedger } from './ledger';
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
  aliases: NameAlias[];
}

function createState(): MockState {
  return {
    members: ROSTER.map((r, i) => ({ id: `m${i + 1}`, name: r.name, aka: [], photoUrl: null })),
    terms: [{ id: 'term1', label: 'Fall 2026', isCurrent: true, duesCents: null }],
    charges: [],
    txns: [],
    payments: [],
    adjustments: [],
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
      postedOn: input.postedOn,
      amountCents: input.amountCents,
      rawDescription: input.rawDescription.trim(),
      pending: input.pending,
      removedAt: null,
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
    if (total !== txn.amountCents) {
      throw new Error('The split has to add up to the credit exactly.');
    }
    const ids = input.allocations.map((a) => a.memberId);
    if (new Set(ids).size !== ids.length) throw new Error('Pick two different brothers.');
    // Mirrors the live unique (bank_txn_id, member_id) index: a double-submit
    // is refused rather than crediting the same brother twice for one credit.
    if (ids.some((id) => state.payments.some((p) => p.bankTxnId === txn.id && p.memberId === id))) {
      throw new Error('That credit is already applied to this brother.');
    }

    input.allocations.forEach((a) => {
      state.payments.push({
        id: randomUUID(),
        bankTxnId: txn.id,
        memberId: a.memberId,
        chargeId: chargeIdFor(a.memberId, term.id),
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
      chargeId: chargeIdFor(memberId, term.id),
      amountCents: txn.amountCents,   // negative: un-credits without deleting history
      appliedBy: ACTOR,
      reason: `Reversal of a returned credit (${txn.rawDescription}).`,
      createdAt: new Date().toISOString(),
    });
    txn.status = 'applied';
  },

  async undoPayment(paymentId: string) {
    const payment = state.payments.find((p) => p.id === paymentId);
    if (!payment) throw new Error('That payment no longer exists.');
    state.payments = state.payments.filter((p) => p.id !== paymentId);
    const siblings = state.payments.filter((p) => p.bankTxnId === payment.bankTxnId);
    if (!siblings.length) {
      const txn = state.txns.find((t) => t.id === payment.bankTxnId);
      if (txn) txn.status = 'queued';
    }
  },

  async setTermDues(amountCents: number) {
    if (amountCents <= 0) throw new Error('Dues must be more than zero.');
    requireTerm().duesCents = amountCents;
  },

  async issueCharges() {
    const term = requireTerm();
    if (!term.duesCents) throw new Error('Set the term dues amount first.');
    const missing = state.members.filter((m) => !chargeIdFor(m.id, term.id));
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
        chargeId: chargeIdFor(sample.returnedMemberId, term.id),
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
        postedOn: c.postedOn,
        amountCents: c.amountCents,
        rawDescription: c.rawDescription,
        pending: c.pending,
        removedAt: null,
        source: 'manual',
        status: 'queued',
        enteredBy: 'Walkthrough',
      });
    });
  },
};
