// UI-facing types for the standalone Dues Desk. Money is always integer cents —
// never floats — because these numbers get compared for exact equality (an
// amount matching a charge to the penny is the matcher's strongest signal).

export type MatchTier = 'clear' | 'check' | 'unclear' | 'return';

// Where a credit came from. Phase 1 is 'manual' only (an exec reading the bank
// app and typing what they see); phase 2 adds 'plaid' rows from the feed.
export type TxnSource = 'manual' | 'plaid';

// A credit's lifecycle. 'queued' is the review queue; 'applied' means at least
// one payment row points at it; 'set_aside' means an exec said "not dues".
export type TxnStatus = 'queued' | 'applied' | 'set_aside';

// 'unbilled' is not a payment state — it's a brother with no charge this term,
// which must not read as "paid".
export type LedgerStatus = 'paid' | 'partial' | 'unpaid' | 'unbilled';

export interface MemberRow {
  id: string;
  name: string;
  aka: string[];        // learned bank-name variants, denormalized from name_aliases
  photoUrl: string | null;
}

export interface Term {
  id: string;
  label: string;
  isCurrent: boolean;
  duesCents: number | null;   // null until an exec sets the term's dues amount
}

export interface DuesCharge {
  id: string;
  memberId: string;
  termId: string;
  amountCents: number;
  description: string;
}

export interface BankTxn {
  id: string;
  providerTxnId: string | null;  // unique when present; the feed's idempotency key
  postedOn: string;              // ISO date
  amountCents: number;           // negative for a returned/reversed payment
  rawDescription: string;        // the descriptor exactly as the bank sent it
  pending: boolean;              // provisional — seen, not settled
  removedAt: string | null;      // the feed reported this txn removed
  source: TxnSource;
  status: TxnStatus;
  enteredBy: string;
}

export interface PaymentRow {
  id: string;
  bankTxnId: string;
  memberId: string;
  chargeId: string | null;
  amountCents: number;
  appliedBy: string;
  reason: string;      // why this txn was credited to this member — the audit trail
  createdAt: string;
}

// A credit that isn't money: the chapter's opportunity fund covering dues for a
// brother on financial aid. Reduces what's owed without pretending a payment
// arrived, so `collected` still means "money actually in the account".
export interface Adjustment {
  id: string;
  memberId: string;
  termId: string;
  amountCents: number;
  kind: 'opp_fund';
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface NameAlias {
  id: string;
  bankName: string;    // normalized sender string as it arrives from the bank
  memberId: string;
  createdBy: string;
  createdAt: string;
}

// One ranked guess at who a credit belongs to.
export interface Candidate {
  memberId: string;
  memberName: string;
  score: number;               // 0..1 name-match strength
  viaAlias: boolean;           // matched a confirmed alias, not the roster name
  outstandingCents: number;    // what this member still owes, for the picker
}

// A queue row: the credit plus everything the UI needs to explain the guess.
export interface QueueItem {
  txn: BankTxn;
  tier: MatchTier;
  candidates: Candidate[];     // ranked, best first; empty when nothing matched
  reason: string;              // human-readable, shipped to the UI
  partial: boolean;            // amount is short of the guess's outstanding balance
  split: boolean;              // exact multiple of dues — likely covers 2+ brothers
  tied: boolean;               // top candidates are indistinguishable; refuse to guess
}

export interface LedgerRow {
  memberId: string;
  name: string;
  aka: string[];
  chargedCents: number;
  oppFundCents: number;
  paidCents: number;
  owedCents: number;       // charged − opp fund
  balanceCents: number;    // owed − paid
  status: LedgerStatus;
}

// The member-facing "what do I owe" row. Comes from the member_balances view,
// which is the only thing the anon key can read — members must never see the
// raw bank descriptors.
export interface PublicBalance {
  memberId: string;
  name: string;
  owedCents: number;
  paidCents: number;
  balanceCents: number;
  status: LedgerStatus;
}

export interface DeskSummary {
  collectedCents: number;
  chargedCents: number;
  oppFundCents: number;
  outstandingCents: number;
  memberCount: number;
  settledCount: number;
  queueCount: number;
  setAsideCount: number;
}

// One read of everything the desk renders. The whole chapter is ~105 members
// and a few hundred rows a term, so the app reads the world once per request
// and derives the ledger in memory rather than maintaining stored totals —
// the chapter app's "raw facts, derived numbers" rule.
export interface Snapshot {
  members: MemberRow[];
  term: Term | null;
  terms: Term[];
  charges: DuesCharge[];
  txns: BankTxn[];
  payments: PaymentRow[];
  adjustments: Adjustment[];
  aliases: NameAlias[];
  /** Who's signed in, for audit fields. 'Exec (mock)' when there's no backend. */
  actor: string;
}
