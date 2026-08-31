// Narrates the bank sync end to end: what the bank hands over, every stage it
// passes through, and the ledger that comes out. Nothing is stubbed — this is
// the same runSync() the daily cron and the button call.
//
//   npx tsx scripts/trace-sync.ts

import { mockBankProvider, resetMockFeed, MOCK_ACCOUNT_ID } from '../lib/bank/mock-provider';
import { mockSyncStore, mockSyncState } from '../lib/bank/mock-sync-store';
import { partitionFeed, runSync } from '../lib/bank/sync';
import { buildDesk } from '../lib/ledger';
import { mockBackend } from '../lib/mock-store';
import { formatCents } from '../lib/money';
import type { FeedTxn } from '../lib/bank/types';

const rule = (t: string) => console.log(`\n${'─'.repeat(78)}\n${t}\n${'─'.repeat(78)}`);
const money = (c: number) => formatCents(c).padStart(9);

// What Plaid actually puts on the wire, before any of our code touches it.
// Note the sign: for a depository account Plaid reports POSITIVE as money OUT.
const RAW_PLAID = [
  { transaction_id: 'plaid-1', amount: -450.00, date: '2026-10-03', original_description: 'ZELLE PMT FROM AARON HENSCHEL', pending: true, pending_transaction_id: null },
  { transaction_id: 'plaid-2', amount: 8400.00, date: '2026-10-03', original_description: 'ACH DEBIT — UNIVERSITY HOUSING RENT', pending: false, pending_transaction_id: null },
  { transaction_id: 'plaid-3', amount: -450.00, date: '2026-10-03', original_description: 'ZELLE PMT FROM LINDA TIAO', pending: false, pending_transaction_id: null },
];

function traceSign() {
  rule('STEP 0 — what Plaid puts on the wire, and the one line that must be right');
  console.log('Plaid reports depository accounts with POSITIVE = money OUT:\n');
  RAW_PLAID.forEach((t) => {
    const flipped = Math.round(-t.amount * 100);
    console.log(`  amount: ${String(t.amount).padStart(9)}  →  amountCents: ${String(flipped).padStart(8)}`
      + `  ${flipped > 0 ? 'money IN  (a dues candidate)' : 'money OUT (chapter spending)'}`);
    console.log(`  ${t.original_description}\n`);
  });
  console.log('Get that flip backwards and every dues payment is classified as spending');
  console.log('and silently dropped. Drop the Math.round and -450.00 * 100 can land on');
  console.log('44999.999…, so no amount ever equals a charge and auto-apply does nothing.');
}

async function main() {
  resetMockFeed();
  mockSyncState.cursor = null;

  traceSign();

  rule('INPUT — page one of the feed, as the app receives it');
  const page1 = await mockBankProvider.syncTransactions({ accessToken: 'x', cursor: null });
  page1.added.forEach((t: FeedTxn) => console.log(
    `  ${t.postedOn}  ${money(t.amountCents)}  ${t.pending ? 'PENDING ' : '        '}${t.rawDescription}`,
  ));
  console.log(`\n  cursor after this page: ${page1.nextCursor}   more pages: ${page1.hasMore}`);
  resetMockFeed();

  rule('STEP 1 — decide what belongs in a dues ledger');
  const demo: FeedTxn[] = [
    ...page1.added.slice(0, 2),
    { providerTxnId: 'rent', accountId: MOCK_ACCOUNT_ID, postedOn: '2026-10-03', amountCents: -840000, rawDescription: 'ACH DEBIT — UNIVERSITY HOUSING RENT', pending: false, pendingTxnId: null },
    { providerTxnId: 'ret', accountId: MOCK_ACCOUNT_ID, postedOn: '2026-10-04', amountCents: -45000, rawDescription: 'ZELLE RETURN — A HENSCHEL', pending: false, pendingTxnId: null },
    { providerTxnId: 'sav', accountId: 'mock-savings', postedOn: '2026-10-04', amountCents: 100000, rawDescription: 'TRANSFER FROM SAVINGS', pending: false, pendingTxnId: null },
    { providerTxnId: 'old', accountId: MOCK_ACCOUNT_ID, postedOn: '2026-08-01', amountCents: 45000, rawDescription: 'ZELLE PMT FROM SOMEBODY', pending: false, pendingTxnId: null },
  ];
  const part = partitionFeed(demo, { accountId: MOCK_ACCOUNT_ID, ingestFrom: '2026-10-01' });
  console.log(`  kept:                       ${part.keep.length}`);
  console.log(`  chapter spending dropped:   ${part.droppedDebitCount}`);
  console.log(`  other account dropped:      ${part.droppedOtherAccountCount}`);
  console.log(`  before the start date:      ${part.droppedBeforeFloorCount}`);
  console.log('\n  kept rows:');
  part.keep.forEach((t) => console.log(`    ${money(t.amountCents)}  ${t.rawDescription}`));
  console.log('\n  A returned payment LEAVES the account, so it arrives as a debit. Keeping it');
  console.log('  is the difference between reversing the payment and leaving the brother');
  console.log('  marked paid forever with nothing anywhere reporting an error.');

  rule('STEP 2 — set up the term, then run the first sync');
  await mockBackend.setTermDues(45000);
  const charged = await mockBackend.issueCharges();
  console.log(`  charged ${charged} brothers $450 each = ${formatCents(charged * 45000)} owed`);

  const first = await runSync({
    provider: mockBankProvider, backend: mockBackend, store: mockSyncStore,
    trigger: 'first_connect', actor: 'trace',
  });
  console.log(`\n  status=${first.status} new=${first.addedCount} auto-applied=${first.autoAppliedCount} `
    + `debits ignored=${first.droppedDebitCount}`);
  console.log(`  cursor saved AFTER the writes: ${mockSyncState.cursor}`);

  let snap = await mockBackend.getSnapshot();
  let desk = buildDesk(snap);
  console.log(`\n  queue=${desk.queue.length} collected=${formatCents(desk.summary.collectedCents)}`);
  desk.queue.slice(0, 4).forEach((q) => {
    console.log(`\n    [${q.tier}] ${formatCents(q.txn.amountCents)}  ${q.txn.rawDescription}`);
    console.log(`      ${q.reason}`);
  });
  if (desk.queue.length > 4) console.log(`\n    …and ${desk.queue.length - 4} more`);

  rule('STEP 3 — the pending payment settles the next day');
  const pendingBefore = snap.txns.filter((t) => t.pending).length;
  const txnsBefore = snap.txns.length;
  const settle = await runSync({
    provider: mockBankProvider, backend: mockBackend, store: mockSyncStore,
    trigger: 'cron', actor: 'trace',
  });
  snap = await mockBackend.getSnapshot();
  console.log(`  the bank sends a NEW transaction id that names the pending one it replaces,`);
  console.log(`  and reports the pending id as removed in the same page.\n`);
  console.log(`  settled=${settle.settledCount}  newly added=${settle.addedCount}`);
  console.log(`  transactions: ${txnsBefore} → ${snap.txns.length}   pending: ${pendingBefore} → ${snap.txns.filter((t) => t.pending).length}`);
  console.log(`\n  The row was updated in place, keeping its id. Inserting a second row instead`);
  console.log(`  is how one $450 payment becomes $900 on the ledger.`);

  rule('STEP 4 — a payment is applied, then the bank takes the credit back');
  snap = await mockBackend.getSnapshot();
  desk = buildDesk(snap);
  const doomed = snap.txns.find((t) => t.providerTxnId === 'mock-txn-1')!;
  if (doomed.status !== 'applied') {
    const item = desk.queue.find((q) => q.txn.id === doomed.id)!;
    await mockBackend.applyCredit({
      txnId: doomed.id,
      allocations: [{ memberId: item.candidates[0].memberId, amountCents: doomed.amountCents }],
      learnAliasFor: item.candidates[0].memberId,
      reason: 'confirmed by an exec',
    });
  }
  snap = await mockBackend.getSnapshot();
  const paidMemberId = snap.payments.find((p) => p.bankTxnId === doomed.id)!.memberId;
  const who = snap.members.find((m) => m.id === paidMemberId)!.name;
  const before = buildDesk(snap).summary.collectedCents;
  console.log(`  ${who} is applied ${formatCents(doomed.amountCents)} — collected is now ${formatCents(before)}`);

  const removal = await runSync({
    provider: mockBankProvider, backend: mockBackend, store: mockSyncStore,
    trigger: 'cron', actor: 'trace',
  });
  snap = await mockBackend.getSnapshot();
  desk = buildDesk(snap);
  const row = desk.rows.find((r) => r.memberId === paidMemberId)!;
  console.log(`\n  removed=${removal.removedCount} reversed=${removal.reversedCount}`);
  console.log(`  collected: ${formatCents(before)} → ${formatCents(desk.summary.collectedCents)}`);
  console.log(`  ${who}: paid ${formatCents(row.paidCents)}, balance ${formatCents(row.balanceCents)}, ${row.status}`);
  const mirror = snap.txns.find((t) => t.rawDescription.startsWith('REMOVED BY BANK'));
  console.log(`\n  the reversal is a new row, never a deletion:`);
  console.log(`    ${mirror?.rawDescription}`);
  console.log(`    ${formatCents(mirror?.amountCents ?? 0)}, status ${mirror?.status} — so it never enters the queue`);

  rule('OUTPUT — the ledger');
  console.log(`  collected ${formatCents(desk.summary.collectedCents)} of ${formatCents(desk.summary.chargedCents)} charged`);
  console.log(`  ${desk.queue.length} credits waiting on a human\n`);
  desk.rows.filter((r) => r.paidCents !== 0).forEach((r) => console.log(
    `    ${r.name.padEnd(24)} paid ${money(r.paidCents)}  balance ${money(r.balanceCents)}  ${r.status}`,
  ));
  console.log('\n  every payment, and why:');
  snap.payments.forEach((p) => {
    const name = snap.members.find((m) => m.id === p.memberId)!.name;
    console.log(`    ${name} — ${formatCents(p.amountCents)}\n      ${p.reason}`);
  });

  rule('PROOF — run the sync again, twice');
  const s1 = buildDesk(await mockBackend.getSnapshot()).summary;
  await runSync({ provider: mockBankProvider, backend: mockBackend, store: mockSyncStore, trigger: 'cron', actor: 'trace' });
  await runSync({ provider: mockBankProvider, backend: mockBackend, store: mockSyncStore, trigger: 'cron', actor: 'trace' });
  const s2 = buildDesk(await mockBackend.getSnapshot()).summary;
  console.log(`  collected ${formatCents(s1.collectedCents)} → ${formatCents(s2.collectedCents)}`);
  console.log(`  queue     ${s1.queueCount} → ${s2.queueCount}`);
  const clean = s1.collectedCents === s2.collectedCents && s1.queueCount === s2.queueCount;
  console.log(`\n${clean ? 'PASS — re-running the sync changed nothing.' : 'FAIL — the ledger moved.'}`);
  process.exit(clean ? 0 : 1);
}

main();
