// The mock/live seam. Every read and write in the app goes through this
// interface, so swapping the in-memory store for Supabase (and later, adding a
// Plaid-fed writer) touches one file and no pages.

import type { BankStatus, PublicBalance, Snapshot } from './types';
import type { RosterCsvRow } from './roster-csv';
import type { FeedTxn } from './bank/types';

export interface RecordCreditInput {
  rawDescription: string;
  amountCents: number;
  postedOn: string;     // ISO date
  pending: boolean;
}

export interface Allocation {
  memberId: string;
  amountCents: number;
}

export interface ApplyCreditInput {
  txnId: string;
  allocations: Allocation[];
  /** Remember this credit's sender string for this member, so it matches next time. */
  learnAliasFor: string | null;
  reason: string;
}

export interface OppFundInput {
  memberId: string;
  amountCents: number;
  reason: string;
}

// One page of the bank feed, already filtered to things that belong in a dues
// ledger. Applying it is a single backend call on purpose: promotion, insertion,
// modification and reversal all move money, and they should live in exactly one
// place rather than being composed by a caller who might get the order wrong.
export interface FeedPageInput {
  added: FeedTxn[];
  modified: FeedTxn[];
  /** Provider txn ids the bank says never happened. */
  removed: string[];
  actor: string;
}

export interface FeedApplyResult {
  /** Rows genuinely inserted — what auto-apply may consider. */
  insertedTxnIds: string[];
  /** Rows promoted from pending to posted — also newly eligible for auto-apply. */
  settledTxnIds: string[];
  modifiedCount: number;
  removedCount: number;
  reversedCount: number;
  /** `removed` ids that were already-promoted pending rows: correctly no-ops. */
  ignoredRemovedCount: number;
}

export interface RosterImportResult {
  keptCount: number;
  addedCount: number;
  removedCount: number;
  aidChangedCount: number;
  /** Names removed, so the confirmation message can be specific. */
  removedNames: string[];
}

export interface DuesBackend {
  getSnapshot(): Promise<Snapshot>;
  /** The login-free member view. Never exposes bank descriptors. */
  getPublicLedger(): Promise<PublicBalance[]>;
  recordCredit(input: RecordCreditInput): Promise<void>;
  applyCredit(input: ApplyCreditInput): Promise<void>;
  setAside(txnId: string): Promise<void>;
  /** Reverse a returned credit: a negative payment row, never a delete. */
  reverseCredit(txnId: string, memberId: string): Promise<void>;
  /** Undo an applied payment — the txn goes back to the queue. */
  undoPayment(paymentId: string): Promise<void>;
  setTermDues(amountCents: number): Promise<void>;
  /**
   * Start a new term and make it current. Rolling over does not touch money: the
   * old term's ledger stays intact and readable, and the bank connection, learned
   * aliases and financial-aid flags carry over because they belong to the chapter
   * rather than to a term.
   *
   * What it also does not do is wipe the slate. Charges are per term, but a
   * BALANCE is not: an unpaid Fall stays unpaid, and the next credit that brother
   * sends settles Fall before it touches the new term (lib/ledger.ts). `startsOn`
   * is what orders the terms, so it is what decides which one is "oldest" — it is
   * worth typing in.
   */
  createTerm(label: string, duesCents: number | null, startsOn: string | null): Promise<void>;
  /**
   * Mark brothers as being on financial aid — a flag and nothing more. It keeps
   * them off the follow-up list so nobody chases someone the chapter already
   * knows about. It does NOT change what they are charged or what they owe;
   * reducing that is a deliberate, separate act (grantOppFund), so "collected"
   * keeps meaning money that actually arrived.
   */
  setFinancialAid(memberIds: string[], enabled: boolean): Promise<void>;
  /**
   * Load a roster from a file.
   *
   * 'pledges' is additive and cannot remove anyone. 'replace' treats the file as
   * the roster: names on it are kept with their history, names missing from it
   * are DELETED — and deleting a brother takes his payments with him, so the
   * amount the chapter recorded as collected in past terms changes. That is a
   * deliberate choice by the chapter; the caller is expected to have shown a
   * summary of exactly what goes first.
   *
   * The plan is recomputed here from the backend's own roster rather than
   * trusted from the caller.
   */
  importRoster(rows: RosterCsvRow[], mode: 'replace' | 'pledges'): Promise<RosterImportResult>;
  /**
   * Mark a brother as abroad this term. Unlike financial aid, this is a real
   * exemption: he is not charged at all, so he owes nothing and appears on no
   * follow-up list. Held per term — being abroad in Winter says nothing about
   * Spring. If a charge was already issued it is removed, unless money has
   * already been applied to it.
   */
  setExempt(memberId: string, reason: string): Promise<void>;
  removeExempt(memberId: string): Promise<void>;
  /** Charge every member who has no charge yet this term. Returns how many. */
  issueCharges(): Promise<number>;
  grantOppFund(input: OppFundInput): Promise<void>;
  removeAdjustment(adjustmentId: string): Promise<void>;
  /* ---- the bank feed ---- */
  /**
   * Apply one page, in the order added → modified → removed. The order is not
   * cosmetic: the bank routinely reports a pending transaction as removed in the
   * same page that carries its posted replacement, so removing first would tear
   * down the row the promotion is about to reuse.
   */
  applyFeedPage(input: FeedPageInput): Promise<FeedApplyResult>;
  /** The redacted connection view. Never exposes the access token or the cursor. */
  getBankStatus(): Promise<BankStatus>;
  setAutoApply(enabled: boolean): Promise<void>;

  /** Seed the walkthrough credits from dues-desk.html. Mock backend only. */
  loadSampleCredits?(): Promise<void>;
}
