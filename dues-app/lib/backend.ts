// The mock/live seam. Every read and write in the app goes through this
// interface, so swapping the in-memory store for Supabase (and later, adding a
// Plaid-fed writer) touches one file and no pages.

import type { PublicBalance, Snapshot } from './types';

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
  /** Charge every member who has no charge yet this term. Returns how many. */
  issueCharges(): Promise<number>;
  grantOppFund(input: OppFundInput): Promise<void>;
  removeAdjustment(adjustmentId: string): Promise<void>;
  /** Seed the walkthrough credits from dues-desk.html. Mock backend only. */
  loadSampleCredits?(): Promise<void>;
}
