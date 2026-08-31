// The bank feed's own shapes. Deliberately NOT `BankTxn` — that name belongs to
// the persisted row in ../types.ts, which carries an `id`, a `status` and an
// `enteredBy`. What arrives from a provider has none of those yet, and conflating
// the two is how a feed row ends up overwriting a queue decision an exec made.

/** One transaction as the app understands it, after the provider's quirks are gone. */
export interface FeedTxn {
  /** The provider's stable id. The idempotency key — a real one, not a hash. */
  providerTxnId: string;
  accountId: string;
  postedOn: string;          // ISO date
  /**
   * Positive = money in, already sign-flipped out of the provider's convention.
   * Plaid reports depository accounts with positive = money OUT; every credit in
   * this app is positive, so the flip happens once, in the provider adapter.
   */
  amountCents: number;
  /** The raw institution string — the only place a Zelle sender's name survives. */
  rawDescription: string;
  pending: boolean;
  /** Set on a posted txn: the id of the pending txn it replaces. */
  pendingTxnId: string | null;
}

/** One page of `/transactions/sync`. */
export interface FeedPage {
  added: FeedTxn[];
  modified: FeedTxn[];
  /** Provider txn ids the institution says never happened. */
  removed: string[];
  nextCursor: string;
  hasMore: boolean;
}

export interface BankAccount {
  accountId: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
}

export interface SyncPageInput {
  accessToken: string;
  cursor: string | null;
}

export interface LinkTokenInput {
  /** Present → update mode: re-authenticate the EXISTING Item. Absent → a new Item. */
  accessToken?: string | null;
}

// Everything a provider must do. Plaid types never cross this line, so swapping
// to Teller or SimpleFIN later touches one file.
export interface BankProvider {
  readonly name: string;
  syncTransactions(input: SyncPageInput): Promise<FeedPage>;
  createLinkToken(input: LinkTokenInput): Promise<string>;
  exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }>;
  getAccounts(accessToken: string): Promise<BankAccount[]>;
  /** Institution display name for the connection panel, best-effort. */
  getInstitutionName(accessToken: string): Promise<string | null>;
}

export type SyncTrigger = 'manual' | 'cron' | 'webhook' | 'first_connect';

export type SyncStatus =
  | 'ok'
  | 'busy'                    // another run holds the lock
  | 'not_connected'
  | 'account_not_selected'    // refuse to sync rather than ingest a savings account
  | 'needs_reauth'
  | 'error';

export interface SyncResult {
  status: SyncStatus;
  addedCount: number;
  settledCount: number;       // pending credits promoted to posted
  modifiedCount: number;
  removedCount: number;
  reversedCount: number;
  droppedDebitCount: number;
  droppedBeforeFloorCount: number;
  autoAppliedCount: number;
  error: string | null;
}

export const EMPTY_SYNC: Omit<SyncResult, 'status' | 'error'> = {
  addedCount: 0,
  settledCount: 0,
  modifiedCount: 0,
  removedCount: 0,
  reversedCount: 0,
  droppedDebitCount: 0,
  droppedBeforeFloorCount: 0,
  autoAppliedCount: 0,
};
