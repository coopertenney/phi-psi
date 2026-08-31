// The sync orchestrator. Every trigger — the button, the daily cron, and later
// the webhook — calls runSync(). There is exactly one implementation of the path
// that moves money.
//
// Two rules in here are load-bearing and easy to "optimize" into bugs:
//
//   1. Write the page BEFORE saving the cursor. Never the reverse, never in a
//      Promise.all. A crash between them replays a page, which is harmless
//      because every write is idempotent. A cursor saved ahead of its writes
//      means the provider never sends those transactions again — money gone,
//      no error, no way to notice.
//   2. Auto-apply runs ONCE, after the whole loop. It reads the ledger a single
//      time and skips a member appearing twice in the batch; calling it per page
//      would let two credits for one brother apply against a stale balance.

import { autoApplyClearMatches } from '../autoapply';
import { runAsService } from '../supabase/context';
import type { DuesBackend } from '../backend';
import { parseDescriptor } from '../match';
import type { BankProvider, FeedPage, FeedTxn, SyncResult, SyncTrigger } from './types';
import { EMPTY_SYNC } from './types';

const MAX_PAGES = 50;

export interface SyncState {
  accessToken: string | null;
  cursor: string | null;
  accountId: string | null;
  ingestFrom: string | null;
}

// How runSync reaches its persisted state. Kept as an interface so the harness
// can drive the whole path in memory with no Supabase project.
export interface SyncStore {
  load(): Promise<SyncState>;
  saveCursor(cursor: string): Promise<void>;
  /** Returns the lock id, or null when another run holds it. */
  acquireLock(): Promise<string | null>;
  releaseLock(lockId: string): Promise<void>;
  startRun(trigger: SyncTrigger): Promise<string>;
  finishRun(runId: string, result: SyncResult): Promise<void>;
  markNeedsReauth(message: string): Promise<void>;
  markSynced(): Promise<void>;
}

export interface PartitionOptions {
  accountId: string | null;
  ingestFrom: string | null;
}

export interface Partition {
  /** Money in, plus returns — everything that belongs in the ledger. */
  keep: FeedTxn[];
  droppedDebitCount: number;
  droppedBeforeFloorCount: number;
  droppedOtherAccountCount: number;
}

/**
 * Decide what belongs in a dues ledger. Sits between the provider and the
 * backend so the provider stays a pure mapper and the writer never sees a debit.
 *
 * The chapter account's full transaction history flows through here — rent,
 * food, vendors, payroll. Only counts of what was dropped are ever recorded;
 * the descriptors are not ours to keep.
 */
export function partitionFeed(txns: FeedTxn[], opts: PartitionOptions): Partition {
  const keep: FeedTxn[] = [];
  let droppedDebitCount = 0;
  let droppedBeforeFloorCount = 0;
  let droppedOtherAccountCount = 0;

  txns.forEach((t) => {
    // A second depository account on the same Item would pipe internal
    // checking↔savings transfers in as "credits", and the matcher would happily
    // rank them as dues.
    if (opts.accountId && t.accountId !== opts.accountId) { droppedOtherAccountCount++; return; }

    // Credits from before go-live have no charge to match against, so every one
    // would land in the queue as unclear. Two hundred rows to set aside by hand
    // is the opposite of what the queue is for.
    if (opts.ingestFrom && t.postedOn < opts.ingestFrom) { droppedBeforeFloorCount++; return; }

    if (t.amountCents > 0) { keep.push(t); return; }

    // Money out — dropped, with one exception. A returned Zelle LEAVES the
    // account, so a plain "credits only" filter discards it and the payment it
    // was meant to reverse stays credited forever: the brother reads as paid and
    // "collected" counts money the chapter no longer has. Nothing errors.
    if (parseDescriptor(t.rawDescription).isReturn) { keep.push(t); return; }

    droppedDebitCount++;
  });

  return { keep, droppedDebitCount, droppedBeforeFloorCount, droppedOtherAccountCount };
}

export interface RunSyncInput {
  provider: BankProvider;
  backend: DuesBackend;
  store: SyncStore;
  trigger: SyncTrigger;
  actor: string;
}

const REAUTH_CODES = ['ITEM_LOGIN_REQUIRED', 'PENDING_EXPIRATION', 'ITEM_ERROR'];

// A sync has no exec session; every RLS policy is `to authenticated`. Without
// this the backend reads zero rows and writes nothing, silently.


export async function runSync(input: RunSyncInput): Promise<SyncResult> {
  return runAsService(() => runSyncInner(input));
}

async function runSyncInner(input: RunSyncInput): Promise<SyncResult> {
  const { provider, backend, store, trigger, actor } = input;
  const result: SyncResult = { ...EMPTY_SYNC, status: 'ok', error: null };

  // The cron at 7:00 and a treasurer clicking at 7:00:03 is a real collision.
  const lockId = await store.acquireLock();
  if (!lockId) { result.status = 'busy'; return result; }

  let runId: string | null = null;
  try {
    const state = await store.load();
    if (!state.accessToken) { result.status = 'not_connected'; return result; }
    // Refusing to sync is the right failure mode here: ingesting the wrong
    // account is worse than ingesting nothing.
    if (!state.accountId) { result.status = 'account_not_selected'; return result; }

    runId = await store.startRun(trigger);

    const insertedTxnIds: string[] = [];
    const settledTxnIds: string[] = [];
    let cursor = state.cursor;

    for (let page = 0; page < MAX_PAGES; page++) {
      let feed: FeedPage;
      try {
        feed = await provider.syncTransactions({ accessToken: state.accessToken, cursor });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // A mutation mid-pagination is the provider asking us to start over from
        // the last saved cursor, which is exactly what the next run does.
        // Plaid's SDK is axios underneath: it does NOT put the error code in
        // `message` ("Request failed with status code 400"). The code lives in
        // the response body, and reading it from the wrong place is why a bank
        // that wants re-authentication would otherwise fail silently forever.
        const code = String((e as any)?.response?.data?.error_code ?? '');
        if (code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'
          || message.includes('MUTATION_DURING_PAGINATION')) break;
        if (REAUTH_CODES.includes(code) || REAUTH_CODES.some((c) => message.includes(c))) {
          await store.markNeedsReauth(code || message);
          result.status = 'needs_reauth';
          result.error = code || message;
          return result;
        }
        throw e;
      }

      const added = partitionFeed(feed.added, state);
      const modified = partitionFeed(feed.modified, state);

      // A correction that turns a credit into a debit is the bank saying the
      // money went the other way. Filtering it out as "a debit" would discard
      // the correction and leave the brother credited, so it is routed into the
      // same reversal path a removal takes.
      const flipped = feed.modified
        .filter((t) => t.amountCents < 0 && !modified.keep.includes(t))
        .map((t) => t.providerTxnId);

      const applied = await backend.applyFeedPage({
        added: added.keep,
        modified: modified.keep,
        removed: [...feed.removed, ...flipped],
        actor,
      });

      // ...and only now. See rule 1 at the top of this file.
      await store.saveCursor(feed.nextCursor);
      cursor = feed.nextCursor;

      insertedTxnIds.push(...applied.insertedTxnIds);
      settledTxnIds.push(...applied.settledTxnIds);
      result.addedCount += applied.insertedTxnIds.length;
      result.settledCount += applied.settledTxnIds.length;
      result.modifiedCount += applied.modifiedCount;
      result.removedCount += applied.removedCount;
      result.reversedCount += applied.reversedCount;
      result.droppedDebitCount += added.droppedDebitCount + modified.droppedDebitCount;
      result.droppedBeforeFloorCount +=
        added.droppedBeforeFloorCount + modified.droppedBeforeFloorCount;

      if (!feed.hasMore) break;
    }

    // Settled ids matter as much as inserted ones: auto-apply refuses pending
    // credits, and a Zelle payment that arrives pending becomes eligible only
    // when it promotes — which is an update, so it yields no insert id. Leave
    // them out and the commonest kind of credit never auto-applies at all.
    const snap = await backend.getSnapshot();
    if (snap.term?.autoApply) {
      result.autoAppliedCount = await autoApplyClearMatches(
        backend, new Set([...insertedTxnIds, ...settledTxnIds]),
      );
    }

    await store.markSynced();
    return result;
  } catch (e) {
    // Mutated, not spread into a new object: `finally` records `result`, so
    // returning a copy would log every failure as a green "ok" run with zero
    // counts — which is exactly how a sync that never works goes unnoticed.
    result.status = 'error';
    result.error = e instanceof Error ? e.message : 'The sync failed.';
    return result;
  } finally {
    if (runId) await store.finishRun(runId, result);
    await store.releaseLock(lockId);
  }
}
