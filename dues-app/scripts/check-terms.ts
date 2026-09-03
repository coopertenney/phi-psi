// A payment settles the OLDEST UNPAID TERM first.
//
//   npx tsx scripts/check-terms.ts
//
// The chapter runs three terms a year at different prices — Fall $537, Winter
// $537, Spring $300 — and a brother can owe two of them at once. Everything
// asserted below used to be wrong in the same silent way: the ledger filtered to
// the current term and `applyCredit` stamped the current term, so a brother who
// paid his Fall dues in January had that money applied to Winter. Fall stayed
// unpaid forever and Winter looked settled by money that was never meant for it,
// and both quarters read as fine.
//
// None of these are happy paths, and none of them announce themselves when they
// break: money landing on the wrong quarter looks exactly like money landing on
// the right one until a term later, when two numbers are wrong instead of one.

import { autoApplyClearMatches, isAutoApplicable } from '../lib/autoapply';
import { buildDesk, buildLedger } from '../lib/ledger';
import { mockBackend as db } from '../lib/mock-store';
import { formatCents } from '../lib/money';
import type { LedgerRow } from '../lib/types';

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

const FALL = 53700;
const WINTER = 53700;
const SPRING = 30000;

async function rows(): Promise<LedgerRow[]> {
  return buildLedger(await db.getSnapshot());
}
const rowFor = (all: LedgerRow[], id: string) => all.find((r) => r.memberId === id)!;
const term = (r: LedgerRow, label: string) => r.terms.find((t) => t.termLabel === label);

/** What a brother's ledger looks like term by term, for the failure output. */
function describe(r: LedgerRow): string {
  const parts = r.terms.map((t) => `${t.termLabel} ${formatCents(t.paidCents)}/${formatCents(t.owedCents)}${t.exempt ? ' (abroad)' : ''}`);
  return `${r.name}: ${parts.join(' | ')} → owes ${formatCents(r.balanceCents)}`;
}

/** Record a credit by hand and hand back the queued txn's id. */
async function credit(description: string, amountCents: number): Promise<string> {
  await db.recordCredit({
    rawDescription: description, amountCents, postedOn: '2027-04-02', pending: false,
  });
  const snap = await db.getSnapshot();
  return snap.txns.filter((t) => t.rawDescription === description).slice(-1)[0].id;
}

/** Record a credit and apply the whole of it to one brother. */
async function pay(memberId: string, description: string, amountCents: number): Promise<string> {
  const txnId = await credit(description, amountCents);
  await db.applyCredit({
    txnId,
    allocations: [{ memberId, amountCents }],
    learnAliasFor: null,
    reason: 'harness',
  });
  return txnId;
}

async function main() {
  /* ─────────────────── three terms, at three different prices ─────────────────── */

  const snap0 = await db.getSnapshot();
  const pick = (name: string) => snap0.members.find((m) => m.name === name)!;

  const onTime = pick('Joshua Koch');          // pays one term exactly
  const spiller = pick('Graham Johnstone');    // pays across two terms
  const settler = pick('Sam Shors');           // pays two terms exactly
  const abroad = pick('Zachary Ewing');        // abroad for the middle term
  const undoer = pick('Sam Cousins');          // his payment gets undone
  const reversed = pick('Lundeen Cahilly');    // the bank takes his credit back
  const autoOne = pick('Saul Hernandez Vigil');// auto-apply, one open term
  const autoTwo = pick('Abraham Yeung');       // auto-apply, two open terms

  await db.setTermDues(FALL);
  await db.issueCharges();

  await db.createTerm('Winter 2027', WINTER, '2027-01-05');
  // Abroad for Winter only. Marked while Winter is current, because being abroad
  // is a fact about one term — and this is the case that proves money skips a
  // term in the MIDDLE of the waterfall rather than only at the end.
  await db.setExempt(abroad.id, 'Madrid, winter quarter');
  await db.issueCharges();

  await db.createTerm('Spring 2027', SPRING, '2027-03-29');
  await db.issueCharges();

  const start = await rows();
  const startSnap = await db.getSnapshot();
  console.log(`terms: ${startSnap.terms.map((t) => `${t.label} ${formatCents(t.duesCents ?? 0)}`).join(' · ')}`);
  console.log(`current term: ${startSnap.term?.label}\n`);

  check('everyone is billed all three terms',
    rowFor(start, onTime.id).balanceCents === FALL + WINTER + SPRING,
    describe(rowFor(start, onTime.id)));
  check('the brother abroad for Winter is billed only Fall and Spring',
    rowFor(start, abroad.id).balanceCents === FALL + SPRING,
    describe(rowFor(start, abroad.id)));
  check('the oldest unpaid term is Fall, not the current one',
    rowFor(start, onTime.id).terms.find(
      (t) => t.termId === rowFor(start, onTime.id).oldestUnpaidTermId,
    )?.termLabel === 'Fall 2026');

  /* ─────────────────── 1. a payment lands on the oldest unpaid term ─────────────────── */
  console.log('\n--- one term\'s dues, paid in Spring ---');

  await pay(onTime.id, 'ZELLE PMT FROM JOSHUA KOCH', FALL);
  const a = rowFor(await rows(), onTime.id);
  console.log(`   ${describe(a)}`);

  check('Fall is settled', term(a, 'Fall 2026')!.balanceCents === 0
    && term(a, 'Fall 2026')!.paidCents === FALL);
  check('the CURRENT term got none of it', term(a, 'Spring 2027')!.paidCents === 0,
    'this is the whole bug: the money used to be stamped with whatever term was current');
  check('Winter got none of it either', term(a, 'Winter 2027')!.paidCents === 0);
  check('he still owes Winter and Spring', a.balanceCents === WINTER + SPRING);
  check('Fall reads paid and Spring reads unpaid',
    term(a, 'Fall 2026')!.status === 'paid' && term(a, 'Spring 2027')!.status === 'unpaid');

  /* ─────────────────── 2. a large payment spills forward ─────────────────── */
  console.log('\n--- $700 against Fall $537 + Winter $537 ---');

  await pay(spiller.id, 'ZELLE PMT FROM GRAHAM JOHNSTONE', 70000);
  const b = rowFor(await rows(), spiller.id);
  console.log(`   ${describe(b)}`);

  check('it clears Fall', term(b, 'Fall 2026')!.paidCents === FALL
    && term(b, 'Fall 2026')!.balanceCents === 0);
  check('and spills $163 into Winter', term(b, 'Winter 2027')!.paidCents === 70000 - FALL,
    formatCents(term(b, 'Winter 2027')!.paidCents));
  check('Winter is partly paid, not settled',
    term(b, 'Winter 2027')!.status === 'partial'
    && term(b, 'Winter 2027')!.balanceCents === WINTER - (70000 - FALL));
  check('nothing reached Spring', term(b, 'Spring 2027')!.paidCents === 0);
  check('the per-term paid figures add up to the money he sent',
    b.terms.reduce((x, t) => x + t.paidCents, 0) === 70000);

  // Two whole terms at once — the "$1074 comes out square on both" case.
  await pay(settler.id, 'ZELLE PMT FROM SAM SHORS', FALL + WINTER);
  const c = rowFor(await rows(), settler.id);
  console.log(`   ${describe(c)}`);
  check('$1074 squares Fall AND Winter',
    term(c, 'Fall 2026')!.balanceCents === 0 && term(c, 'Winter 2027')!.balanceCents === 0);
  check('and leaves Spring untouched', term(c, 'Spring 2027')!.balanceCents === SPRING);

  /* ─────────────────── 3. money skips a term he was abroad for ─────────────────── */
  console.log('\n--- abroad for Winter, pays Fall + Spring in one credit ---');

  await pay(abroad.id, 'ZELLE PMT FROM ZACHARY EWING', FALL + SPRING);
  const d = rowFor(await rows(), abroad.id);
  console.log(`   ${describe(d)}`);

  check('the Winter he was abroad for received nothing',
    term(d, 'Winter 2027')!.paidCents === 0,
    'an exemption is the absence of a charge — there is nothing there for money to land on');
  check('Winter still reads abroad, not paid',
    term(d, 'Winter 2027')!.status === 'exempt' && term(d, 'Winter 2027')!.exempt,
    'reading as paid would make the collected figure look like money that arrived');
  check('the money skipped over it into Spring',
    term(d, 'Fall 2026')!.balanceCents === 0 && term(d, 'Spring 2027')!.balanceCents === 0);
  check('he is square, with nothing overpaid',
    d.balanceCents === 0 && d.overpaidCents === 0);

  /* ─────────────────── 4. undoing a payment restores both terms ─────────────────── */
  console.log('\n--- undo a payment that had settled two terms ---');

  const undoTxn = await pay(undoer.id, 'ZELLE PMT FROM SAM COUSINS', FALL + WINTER);
  const beforeUndo = rowFor(await rows(), undoer.id);
  check('both terms are settled first',
    beforeUndo.balanceCents === SPRING, describe(beforeUndo));

  const snapU = await db.getSnapshot();
  const payment = snapU.payments.find((p) => p.bankTxnId === undoTxn && p.memberId === undoer.id)!;
  await db.undoPayment(payment.id);
  const afterUndo = rowFor(await rows(), undoer.id);
  console.log(`   ${describe(afterUndo)}`);

  check('BOTH terms go back to unpaid, not just one',
    term(afterUndo, 'Fall 2026')!.balanceCents === FALL
    && term(afterUndo, 'Winter 2027')!.balanceCents === WINTER,
    'a stored allocation would have left the second term pointing at money that is gone');
  check('he owes all three terms again',
    afterUndo.balanceCents === FALL + WINTER + SPRING);
  check('the credit is back in the queue',
    (await db.getSnapshot()).txns.find((t) => t.id === undoTxn)!.status === 'queued');

  /* ─────────────────── 5. the bank takes a credit back ─────────────────── */
  console.log('\n--- the bank reverses a credit ---');

  const page = await db.applyFeedPage({
    added: [{
      providerTxnId: 'rev-1', accountId: 'acct', postedOn: '2027-04-03',
      amountCents: FALL, rawDescription: 'ZELLE PMT FROM LUNDEEN CAHILLY',
      pending: false, pendingTxnId: null,
    }],
    modified: [],
    removed: [],
    actor: 'harness',
  });
  await db.applyCredit({
    txnId: page.insertedTxnIds[0],
    allocations: [{ memberId: reversed.id, amountCents: FALL }],
    learnAliasFor: null,
    reason: 'harness',
  });
  const beforeRemoval = rowFor(await rows(), reversed.id);
  check('the credit settled Fall, his oldest unpaid term',
    term(beforeRemoval, 'Fall 2026')!.balanceCents === 0
    && term(beforeRemoval, 'Winter 2027')!.balanceCents === WINTER,
    describe(beforeRemoval));

  const removal = await db.applyFeedPage({
    added: [], modified: [], removed: ['rev-1'], actor: 'harness',
  });
  const afterRemoval = rowFor(await rows(), reversed.id);
  console.log(`   ${describe(afterRemoval)}`);

  check('the reversal un-credited the term the money had settled',
    term(afterRemoval, 'Fall 2026')!.balanceCents === FALL
    && term(afterRemoval, 'Fall 2026')!.paidCents === 0,
    'money the bank says never arrived must not leave a term reading paid');
  check('and it did not silently un-credit a different term',
    term(afterRemoval, 'Winter 2027')!.balanceCents === WINTER
    && term(afterRemoval, 'Spring 2027')!.balanceCents === SPRING);
  check('he owes all three terms again',
    afterRemoval.balanceCents === FALL + WINTER + SPRING);
  check('the reversal is a negative payment row, not a deletion',
    removal.reversedCount === 1
    && (await db.getSnapshot()).payments.some(
      (p) => p.memberId === reversed.id && p.amountCents === -FALL,
    ));

  /* ─────────────────── 6. re-running double-counts nothing ─────────────────── */
  console.log('\n--- re-run everything ---');

  const before = buildDesk(await db.getSnapshot());
  await db.applyFeedPage({
    added: [{
      providerTxnId: 'rev-1', accountId: 'acct', postedOn: '2027-04-03',
      amountCents: FALL, rawDescription: 'ZELLE PMT FROM LUNDEEN CAHILLY',
      pending: false, pendingTxnId: null,
    }],
    modified: [],
    removed: ['rev-1'],
    actor: 'harness',
  });
  const after = buildDesk(await db.getSnapshot());

  check('re-syncing the same page changes no balance',
    after.summary.outstandingCents === before.summary.outstandingCents
    && after.summary.collectedCents === before.summary.collectedCents,
    `${formatCents(before.summary.outstandingCents)} → ${formatCents(after.summary.outstandingCents)}`);
  check('and does not reverse the reversal twice',
    (await db.getSnapshot()).payments.filter(
      (p) => p.memberId === reversed.id && p.amountCents === -FALL,
    ).length === 1);

  // Deriving the ledger twice from the same rows has to give the same answer —
  // the guard against an allocation that depends on how many times it ran.
  const twice = buildLedger(await db.getSnapshot());
  check('deriving the ledger again gives identical numbers',
    JSON.stringify(twice) === JSON.stringify(after.rows));

  // Applying the same credit to the same brother a second time is refused by the
  // same guard that mirrors `unique (bank_txn_id, member_id)`.
  let refused = false;
  try {
    await db.applyCredit({
      txnId: undoTxn,
      allocations: [{ memberId: undoer.id, amountCents: FALL + WINTER }],
      learnAliasFor: null,
      reason: 'double submit',
    });
    await db.applyCredit({
      txnId: undoTxn,
      allocations: [{ memberId: undoer.id, amountCents: FALL + WINTER }],
      learnAliasFor: null,
      reason: 'double submit',
    });
  } catch {
    refused = true;
  }
  check('one credit cannot be applied to the same brother twice', refused);

  /* ─────────────────── 7. auto-apply refuses to guess a term ─────────────────── */
  console.log('\n--- auto-apply with two terms open ---');

  // Both brothers owe Fall, Winter and Spring. One sends exactly his oldest
  // term; the other sends an amount that fits no whole number of terms.
  const exactTxn = await credit(`ZELLE PMT FROM ${autoOne.name.toUpperCase()}`, FALL);
  const oddTxn = await credit(`ZELLE PMT FROM ${autoTwo.name.toUpperCase()}`, 20000);

  const desk = buildDesk(await db.getSnapshot());
  const exactItem = desk.queue.find((q) => q.txn.id === exactTxn)!;
  const oddItem = desk.queue.find((q) => q.txn.id === oddTxn)!;
  console.log(`   exact: [${exactItem.tier}] ${exactItem.reason}`);
  console.log(`   odd:   [${oddItem.tier}] ${oddItem.reason}`);

  check('an amount that squares his oldest term still reads confident',
    exactItem.tier === 'clear' && exactItem.termCertain && isAutoApplicable(exactItem),
    'a payment matching SOME term must not stop being obvious just because two terms are open');
  check('an amount that fits no whole term will not auto-apply',
    !oddItem.termCertain && !isAutoApplicable(oddItem),
    'oldest-first would put $200 on Fall, and he may well have meant Spring');
  check('the odd amount still queues with a guess, rather than vanishing',
    oddItem.candidates[0]?.memberId === autoTwo.id && oddItem.tier === 'check');

  const applied = await autoApplyClearMatches(db, new Set([exactTxn, oddTxn]));
  const autoRows = await rows();
  console.log(`   auto-applied ${applied}`);
  check('exactly the unambiguous one was applied automatically', applied === 1);
  check('and it landed on Fall, his oldest unpaid term',
    term(rowFor(autoRows, autoOne.id), 'Fall 2026')!.balanceCents === 0
    && term(rowFor(autoRows, autoOne.id), 'Spring 2027')!.balanceCents === SPRING);
  check('the odd credit is still waiting for a human',
    (await db.getSnapshot()).txns.find((t) => t.id === oddTxn)!.status === 'queued');

  /* ─────────────────── 8. the summary splits the terms honestly ─────────────────── */
  console.log('\n--- the desk summary ---');

  const final = buildDesk(await db.getSnapshot());
  const s = final.summary;
  console.log(`   collected (Spring 2027) ${formatCents(s.collectedCents)}`);
  console.log(`   outstanding all terms   ${formatCents(s.outstandingCents)}`
    + ` = ${formatCents(s.outstandingThisTermCents)} this term`
    + ` + ${formatCents(s.priorOutstandingCents)} earlier`);

  check('outstanding spans every term',
    s.outstandingCents === final.rows.reduce((x, r) => x + r.balanceCents, 0));
  check('the current-term slice and the earlier slice add up',
    s.outstandingThisTermCents + s.priorOutstandingCents === s.outstandingCents);
  check('earlier terms are actually carrying a balance',
    s.priorOutstandingCents > 0 && s.priorOwingCount > 0,
    'with three terms open and most brothers unpaid, a zero here means the ledger is still single-term');
  check('collected is the CURRENT term only, not every term ever',
    s.collectedCents === final.rows.reduce((x, r) => x + (r.current?.paidCents ?? 0), 0)
    && s.collectedCents < final.rows.reduce((x, r) => x + Math.max(0, r.paidCents), 0),
    'summed across years a "collected" figure climbs forever and its percentage stops meaning anything');
  check('charged is the current term only',
    s.chargedCents === final.rows.reduce((x, r) => x + (r.current?.chargedCents ?? 0), 0));
  check('the brother abroad for Winter is still chased for what he owed Fall',
    final.rows.filter((r) => r.balanceCents > 0 && !r.financialAid).length === s.followUpCount);

  /* ─────────────────── 9. the member page agrees with the desk ─────────────────── */

  const publicRows = await db.getPublicLedger();
  const mismatch = publicRows.find((p) => {
    const r = final.rows.find((x) => x.memberId === p.memberId)!;
    return p.balanceCents !== r.balanceCents || p.owedCents !== r.owedCents
      || p.paidCents !== r.paidCents || p.status !== r.status;
  });
  check('the member-facing balances match the desk, brother for brother',
    !mismatch,
    mismatch ? `${mismatch.name} reads ${formatCents(mismatch.balanceCents)} publicly` : '');

  console.log(failures ? `\n${failures} FAILED` : '\nall term checks ok');
  process.exit(failures ? 1 : 0);
}

main();
