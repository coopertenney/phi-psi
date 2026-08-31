// UI-facing types for the standalone Dues Desk. Money is always integer cents —
// never floats — because these numbers get compared for exact equality (an
// amount matching a charge to the penny is the matcher's strongest signal).

export type MatchTier = 'clear' | 'check' | 'unclear' | 'return';

// Where a credit came from. 'manual' is an exec reading the bank app and typing
// what they see; 'plaid' is a row off the live bank feed.
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
  /**
   * On financial aid. Deliberately a flag and nothing more: the charge stands,
   * the balance stands, the money math is untouched. All it does is keep them
   * off the follow-up list, so nobody chases a brother the chapter already knows
   * about. Reducing what they owe is a separate, deliberate act — an opportunity
   * fund grant — so "collected" never quietly changes meaning.
   */
  financialAid: boolean;
}

export interface Term {
  id: string;
  label: string;
  isCurrent: boolean;
  duesCents: number | null;   // null until an exec sets the term's dues amount
  // Whether the sync may apply its own certain matches. Per-term because that's
  // the right granularity for widening it after watching a term of real data,
  // and persisted because cron runs with nobody watching — it used to be a
  // checkbox on a screen an exec was standing in front of.
  autoApply: boolean;
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
  /** Set on a posted row: the pending txn id it replaced, so the feed's later
   *  `removed` for that pending id is recognized as a promotion, not an erasure. */
  pendingTxnId: string | null;
  accountId: string | null;
  removedAt: string | null;      // the feed reported this txn removed
  /** The feed changed this credit's amount after it had already been applied. */
  amountChangedAt: string | null;
  source: TxnSource;
  status: TxnStatus;
  enteredBy: string;
}

export interface PaymentRow {
  id: string;
  bankTxnId: string;
  memberId: string;
  // Which term this money paid. Charges are term-scoped, so payments must be
  // too — without it, last term's payments settle this term's charges and the
  // whole chapter reads "paid" the day a new term becomes current.
  termId: string;
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
  /**
   * The NAME is beyond doubt — one brother, no tie, no relative, no suffix, and
   * the runner-up is nowhere close. Deliberately separate from the tier, which
   * also weighs the amount: a partial payment from an unmistakable sender has a
   * certain name and an unusual amount, and those two facts deserve separate
   * answers. lib/autoapply.ts decides what to do with money; this decides only
   * whether we know whose money it is.
   */
  nameCertain: boolean;
  /** No sender name in the descriptor at all. */
  noSender: boolean;
  /**
   * The descriptor isn't a person-to-person transfer at all — a check deposit,
   * interest, a fee, a wire reference. Nobody sent this, so nobody can be
   * matched to it, however the roster is searched.
   */
  notAPerson: boolean;
  /** The credit is larger than the guess's outstanding balance. */
  overpay: boolean;
}

export interface LedgerRow {
  memberId: string;
  name: string;
  aka: string[];
  financialAid: boolean;
  chargedCents: number;
  oppFundCents: number;
  paidCents: number;
  owedCents: number;       // charged − opp fund
  /** Never negative: money past what was owed is reported as overpaid, not as a
   *  negative balance, so "balance" always reads as "what is still owed". */
  balanceCents: number;
  /** Paid past the balance. A flag, not a credit against next term. */
  overpaidCents: number;
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
  /** Brothers who owe and aren't on financial aid — the actual follow-up list. */
  followUpCount: number;
  aidCount: number;
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

/* ─────────────────────────── the bank connection ─────────────────────────── */

// What an exec is allowed to know about the bank link. Contains no access token
// and no cursor: those live in `sync_state`, which only the service role reads.
export interface BankStatus {
  connected: boolean;
  institutionName: string | null;
  accountName: string | null;
  accountMask: string | null;
  accountSelected: boolean;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  needsReauth: boolean;
  lastError: string | null;
  /** Recent syncs, newest first — the answer to "did it run, and what did it do?" */
  runs: SyncRunRow[];
}

export interface SyncRunRow {
  id: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  addedCount: number;
  settledCount: number;
  modifiedCount: number;
  removedCount: number;
  reversedCount: number;
  droppedDebitCount: number;
  autoAppliedCount: number;
  status: string;
  error: string | null;
}
