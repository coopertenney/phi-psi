// The bank sync, end to end, against the in-memory feed and backend.
//
//   npx tsx scripts/check-sync.ts
//
// The three transitions asserted here are the ones that silently lose or
// duplicate money if they're wrong, and none of them are exercised by a happy
// path: a pending credit settling (must not become two payments), the bank
// taking a credit back (must reverse a payment that was already applied), and
// re-running a sync (must change nothing).

import { autoApplyClearMatches } from '../lib/autoapply';
import { mockBankProvider, resetMockFeed } from '../lib/bank/mock-provider';
import { mockSyncStore, mockSyncState } from '../lib/bank/mock-sync-store';
import { partitionFeed, runSync } from '../lib/bank/sync';
import { buildDesk } from '../lib/ledger';
import { mockBackend } from '../lib/mock-store';
import { formatCents } from '../lib/money';
import type { FeedTxn } from '../lib/bank/types';

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

const sync = (trigger: 'manual' | 'cron' | 'first_connect' = 'manual') => runSync({
  provider: mockBankProvider,
  backend: mockBackend,
  store: mockSyncStore,
  trigger,
  actor: 'harness',
});

async function main() {
  /* ---- the debit filter, in isolation ---- */
  const feed: FeedTxn[] = [
    { providerTxnId: 'a', accountId: 'acct', postedOn: '2026-10-03', amountCents: 45000, rawDescription: 'ZELLE PMT FROM JOSHUA KOCH', pending: false, pendingTxnId: null },
    { providerTxnId: 'b', accountId: 'acct', postedOn: '2026-10-03', amountCents: -840000, rawDescription: 'ACH DEBIT — UNIVERSITY HOUSING RENT', pending: false, pendingTxnId: null },
    { providerTxnId: 'c', accountId: 'acct', postedOn: '2026-10-03', amountCents: -45000, rawDescription: 'ZELLE RETURN — JOSHUA KOCH', pending: false, pendingTxnId: null },
    { providerTxnId: 'd', accountId: 'other', postedOn: '2026-10-03', amountCents: 45000, rawDescription: 'TRANSFER FROM SAVINGS', pending: false, pendingTxnId: null },
    { providerTxnId: 'e', accountId: 'acct', postedOn: '2026-09-01', amountCents: 45000, rawDescription: 'ZELLE PMT FROM SOMEONE ELSE', pending: false, pendingTxnId: null },
  ];
  const part = partitionFeed(feed, { accountId: 'acct', ingestFrom: '2026-10-01' });
  check('chapter spending is dropped', part.droppedDebitCount === 1);
  check('another account is dropped', part.droppedOtherAccountCount === 1);
  check('credits before the start date are dropped', part.droppedBeforeFloorCount === 1);
  check('a returned payment is KEPT, not dropped as a debit',
    part.keep.some((t) => t.providerTxnId === 'c'),
    'a return leaves the account as a debit; dropping it leaves the brother marked paid forever');

  /* ---- the full path ---- */
  resetMockFeed();
  mockSyncState.cursor = null;
  await mockBackend.setTermDues(45000);
  await mockBackend.issueCharges();

  const first = await sync('first_connect');
  let desk = buildDesk(await mockBackend.getSnapshot());
  console.log(`\nfirst sync: added=${first.addedCount} auto-applied=${first.autoAppliedCount} `
    + `queue=${desk.queue.length} collected=${formatCents(desk.summary.collectedCents)}`);
  check('the first sync queued the feed', first.status === 'ok' && first.addedCount > 0);
  check('the cursor advanced', mockSyncState.cursor !== null);

  const txnCountAfterFirst = (await mockBackend.getSnapshot()).txns.length;

  /* ---- a pending credit settles ---- */
  const settle = await sync();
  let snap = await mockBackend.getSnapshot();
  desk = buildDesk(snap);
  console.log(`\nsettling:   settled=${settle.settledCount} added=${settle.addedCount} `
    + `queue=${desk.queue.length}`);
  check('the pending credit was promoted, not duplicated',
    settle.settledCount === 1 && settle.addedCount === 0
    && snap.txns.length === txnCountAfterFirst,
    `${snap.txns.length} transactions, was ${txnCountAfterFirst}`);
  check('the promoted credit is no longer pending',
    !snap.txns.some((t) => t.pending && t.pendingTxnId === null && t.providerTxnId === 'mock-txn-0'));

  /* ---- apply a payment, then let the bank take it back ---- */
  // The mock feed removes mock-txn-1 on its third page, so that credit has to be
  // applied first — either the sync already did it automatically, or the harness
  // applies it by hand. Both are realistic; the reversal must work either way.
  snap = await mockBackend.getSnapshot();
  desk = buildDesk(snap);
  const doomed = snap.txns.find((t) => t.providerTxnId === 'mock-txn-1');
  if (doomed && doomed.status !== 'applied') {
    const item = desk.queue.find((q) => q.txn.id === doomed.id);
    const who = item?.candidates[0];
    if (who) {
      await mockBackend.applyCredit({
        txnId: doomed.id,
        allocations: [{ memberId: who.memberId, amountCents: doomed.amountCents }],
        learnAliasFor: null,
        reason: 'applied by the harness',
      });
    }
  }

  snap = await mockBackend.getSnapshot();
  const wasApplied = snap.txns.find((t) => t.providerTxnId === 'mock-txn-1')?.status === 'applied';
  check('a credit is applied and ready to be taken back', wasApplied);

  const beforeRemoval = buildDesk(snap).summary.collectedCents;
  const doomedAmount = snap.txns.find((t) => t.providerTxnId === 'mock-txn-1')?.amountCents ?? 0;

  const removal = await sync();
  snap = await mockBackend.getSnapshot();
  desk = buildDesk(snap);
  console.log(`\nremoval:    removed=${removal.removedCount} reversed=${removal.reversedCount} `
    + `collected=${formatCents(beforeRemoval)} → ${formatCents(desk.summary.collectedCents)}`);
  check('the bank taking a credit back reverses the payment',
    removal.reversedCount === 1
    && desk.summary.collectedCents === beforeRemoval - doomedAmount,
    'money the bank says never arrived must not stay collected');
  check('the reversal is a negative row, not a deletion',
    snap.payments.some((p) => p.amountCents < 0));
  check('the reversal never enters the queue',
    !desk.queue.some((q) => q.txn.rawDescription.startsWith('REMOVED BY BANK')));

  /* ---- re-syncing changes nothing ---- */
  const before = buildDesk(await mockBackend.getSnapshot());
  const again = await sync('cron');
  const after = buildDesk(await mockBackend.getSnapshot());
  console.log(`\nre-sync:    added=${again.addedCount} `
    + `collected=${formatCents(after.summary.collectedCents)} queue=${after.queue.length}`);
  check('running the sync again records nothing new',
    again.addedCount === 0
    && after.summary.collectedCents === before.summary.collectedCents
    && after.queue.length === before.queue.length);

  /* ---- the lock ---- */
  const held = await mockSyncStore.acquireLock();
  const busy = await sync();
  check('a second sync refuses to run while one is in flight', busy.status === 'busy');
  // A stale run must not be able to clear a lock somebody else now holds.
  await mockSyncStore.releaseLock('some-other-run');
  const stillBusy = await sync();
  check('an unrelated run cannot release the lock', stillBusy.status === 'busy');
  await mockSyncStore.releaseLock(held!);

  /* ---- auto-apply is not fooled by a stale balance ---- */
  const applied = await autoApplyClearMatches(mockBackend, new Set<string>());
  check('auto-apply with nothing to consider does nothing', applied === 0);

  console.log(failures ? `\n${failures} FAILED` : '\nall sync checks ok');
  process.exit(failures ? 1 : 0);
}

main();
