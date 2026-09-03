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

// Neither 'unbilled' nor 'exempt' is a payment state. 'unbilled' is a brother
// nobody has charged yet; 'exempt' is one the chapter decided not to charge —
// he is abroad this quarter. Both must be visibly different from "paid", or the
// collected figure starts looking like money that arrived.
export type LedgerStatus = 'paid' | 'partial' | 'unpaid' | 'unbilled' | 'exempt';

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
  /** First day of the term. Orders terms honestly — creation order is not the
   *  same thing — and gives the bank connection a sensible date to start from. */
  startsOn: string | null;
  /**
   * When the row was written. Only a tiebreaker: two terms nobody dated still
   * have to sort into a definite order, because the whole payment waterfall
   * depends on knowing which term is older. See `termsOldestFirst`.
   */
  createdAt: string;
  isCurrent: boolean;
  duesCents: number | null;   // null until an exec sets the term's dues amount
  // Whether the sync may apply its own certain matches. Per-term because that's
  // the right granularity for widening it after watching a term of real data,
  // and persisted because cron runs with nobody watching — it used to be a
  // checkbox on a screen an exec was standing in front of.
  autoApply: boolean;
}

// A brother the chapter decided not to charge this term — studying abroad. Held
// per term, not on the member: being abroad in Winter says nothing about Spring.
// Deliberately an absence of a charge rather than a charge that was waived, so
// he reads as 'exempt' instead of 'paid' and never appears as money owed.
export interface Exemption {
  id: string;
  memberId: string;
  termId: string;
  reason: string;
  createdBy: string;
  createdAt: string;
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
  /**
   * The term that was CURRENT when this money was recorded — an audit fact about
   * when, not a claim about what it settled. Which term(s) the money actually
   * pays is derived at read time by lib/ledger.ts, oldest unpaid first, because a
   * brother who pays his Fall dues in January is paying Fall.
   *
   * It used to mean "the term this money paid", and that was the bug: rolling
   * over to Winter made every January credit settle Winter and left Fall unpaid
   * forever, with both quarters silently wrong.
   */
  termId: string;
  /**
   * Legacy, and deliberately null on anything written now: a payment can span two
   * terms' charges (see the spill in lib/ledger.ts), so it cannot point at one
   * charge row. Kept nullable so history written before the waterfall still reads.
   */
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
  /** Everything this member still owes, across every open term. */
  outstandingCents: number;
  /** What the oldest term he still owes on would take to settle — where a
   *  payment lands first. Equals outstandingCents when only one term is open. */
  oldestTermCents: number;
  /** That term's name, for the reason string ("settles his Fall 2026 dues"). */
  oldestTermLabel: string | null;
  /** How many terms he still owes something on. 1 means the money has nowhere
   *  else it could go, which is what makes an unattended apply safe. */
  openTermCount: number;
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
  /**
   * We know WHICH TERM(S) this money settles, beyond argument. The sibling of
   * `nameCertain`: that one answers "whose money is this", this one answers
   * "where does it land". Both have to be true before anything moves unattended.
   *
   * True in exactly three shapes, and they are the only three where the
   * oldest-unpaid-first waterfall has no discretion left:
   *   - he owes on at most one term, so there is nowhere else it could go;
   *   - the amount squares a whole run of his open terms exactly;
   *   - the amount covers everything he owes, so every term is settled and the
   *     remainder is flagged as overpaid.
   * Anything else leaves a term part-paid — a brother owing Fall $537 and
   * Spring $300 who sends $300 probably meant Spring, and oldest-first would put
   * it on Fall. That is a human decision, so it queues.
   */
  termCertain: boolean;
  /**
   * When `split` is set, the per-brother term charge the amount divides into —
   * which is not necessarily the current term's, now that Fall and Spring cost
   * different amounts. Null when nothing looked like a multiple.
   */
  splitShareCents: number | null;
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

// One brother's standing in ONE term. The chapter runs three terms a year at
// different prices and a brother can owe two of them at once, so the per-term
// slice is a first-class row rather than something the UI reconstructs.
export interface LedgerTermRow {
  termId: string;
  termLabel: string;
  isCurrent: boolean;
  /** Abroad that term, so deliberately not charged. */
  exempt: boolean;
  chargedCents: number;
  oppFundCents: number;
  owedCents: number;       // charged − opp fund
  /**
   * How much of his money the waterfall put on THIS term — derived, never
   * stored. Capped at owedCents: money past the last open term is overpayment,
   * reported on the member row, not stuffed into a term that didn't earn it.
   */
  paidCents: number;
  balanceCents: number;    // owed − allocated, never negative
  status: LedgerStatus;
}

export interface LedgerRow {
  memberId: string;
  name: string;
  aka: string[];
  financialAid: boolean;
  /** Abroad in the CURRENT term, so deliberately not charged for it. He may
   *  still owe an earlier term, which is why this is not the same as owing
   *  nothing. */
  exempt: boolean;
  /* Every money figure below is ACROSS ALL TERMS, not just the current one.
     That is the change the whole feature turns on: a brother who never paid Fall
     still owes it in Winter, and a ledger that only ever showed the current term
     hid that. The per-term breakdown is in `terms`, and the current term's slice
     is `current`, so nothing that was term-scoped became unavailable. */
  chargedCents: number;
  oppFundCents: number;
  /** Net money actually received from him, all terms, reversals included. A raw
   *  fact — unlike LedgerTermRow.paidCents it is not capped at what he owed, so
   *  it can exceed the sum of the per-term figures when he has overpaid. */
  paidCents: number;
  owedCents: number;       // charged − opp fund
  /** Never negative: money past what was owed is reported as overpaid, not as a
   *  negative balance, so "balance" always reads as "what is still owed". */
  balanceCents: number;
  /** Paid past everything owed. A flag, not a credit against a future term —
   *  though a later term's charge will absorb it, because the waterfall is
   *  re-derived from the whole pool every read. */
  overpaidCents: number;
  status: LedgerStatus;
  /** Oldest term first. Only terms he was charged for or exempted from. */
  terms: LedgerTermRow[];
  /** The current term's slice, for the numbers that are honestly term-scoped. */
  current: LedgerTermRow | null;
  /** The oldest term he still owes on — where the next payment lands. */
  oldestUnpaidTermId: string | null;
  /** What that term would take to settle. 0 when he owes nothing. */
  oldestUnpaidCents: number;
  /**
   * Running totals of his open terms, oldest first: [oldest, oldest+next, …].
   * These are the amounts a brother actually sends, and the only ones that
   * settle a whole number of terms — the matcher's amount signal.
   */
  settlingAmounts: number[];
}

// The member-facing "what do I owe" row. Comes from the member_balances view,
// which is the only thing the anon key can read — members must never see the
// raw bank descriptors.
//
// Across ALL terms, exactly like LedgerRow, because the two screens have to
// agree: a brother reading "$0" here while the desk chases him for last
// quarter's dues is the bug this page exists to prevent.
export interface PublicBalance {
  memberId: string;
  name: string;
  owedCents: number;
  paidCents: number;
  balanceCents: number;
  status: LedgerStatus;
}

/**
 * The desk's headline numbers. Which of these are term-scoped and which span
 * every term is a deliberate, per-number decision — an exec is already reading
 * these and none of them may quietly change meaning:
 *
 *   - collected / charged / oppFund → THE CURRENT TERM. These answer "how is
 *     this term going", and they are read against the term's dues amount and as
 *     a percentage. Summed across years they would climb forever and the
 *     percentage would stop meaning anything.
 *   - outstanding / followUpCount / settledCount → EVERY TERM. These answer
 *     "what is the chapter owed and who do I chase", and scoping them to the
 *     current term is precisely the bug: a brother who never paid Fall
 *     disappeared from both the moment the exec rolled over to Winter.
 *   - aidCount → a member flag, no term at all.
 *   - exemptCount → the current term, because "abroad" is a fact about one term.
 *
 * `outstandingThisTermCents` and `priorOutstandingCents` split the all-terms
 * figure, so the term number an exec used to read is still on the screen rather
 * than replaced.
 */
/**
 * What the matcher needs to know about one brother's money.
 *
 * "Outstanding" stopped being a single number the day two terms could be open at
 * once, and collapsing it back to one is exactly what makes a payment land on
 * the wrong quarter. Lives here rather than in lib/ledger.ts so lib/match.ts can
 * name it without the two files importing each other.
 */
export interface MemberBalance {
  /** Everything he still owes, across every open term. */
  totalCents: number;
  /** What the oldest open term would take — where the next dollar lands. */
  oldestCents: number;
  oldestTermLabel: string | null;
  /** Running totals of his open terms, oldest first: [oldest, oldest+next, …].
   *  The last entry equals totalCents. These are the only amounts that settle a
   *  whole number of terms. */
  settlingAmounts: number[];
  openTermCount: number;
}

export interface DeskSummary {
  /** Current term. Money that arrived against this term's charges. */
  collectedCents: number;
  /** Current term. */
  chargedCents: number;
  /** Current term. */
  oppFundCents: number;
  /** ALL terms — the chapter's real receivable. */
  outstandingCents: number;
  /** The slice of `outstandingCents` that belongs to the current term. */
  outstandingThisTermCents: number;
  /** The slice owed on terms that have already ended. */
  priorOutstandingCents: number;
  /** Brothers carrying a balance from a term other than the current one. */
  priorOwingCount: number;
  memberCount: number;
  /** All terms: square with the chapter, not just with this quarter. */
  settledCount: number;
  queueCount: number;
  setAsideCount: number;
  /** Brothers who owe on ANY term and aren't on financial aid — the follow-up
   *  list. Term-scoping this is what let a Fall debt go unchased all winter. */
  followUpCount: number;
  aidCount: number;
  /** Current term: abroad is a fact about one term. */
  exemptCount: number;
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
  exemptions: Exemption[];
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
