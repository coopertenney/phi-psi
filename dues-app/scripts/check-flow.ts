// End-to-end check of the write paths against the mock backend: confirm a
// match, split a doubled credit, reverse a return, undo a payment, grant from
// the opportunity fund. `npx tsx scripts/check-flow.ts`
import { mockBackend as db } from '../lib/mock-store';
import { buildDesk } from '../lib/ledger';
import { formatCents } from '../lib/money';

const show = async (label: string) => {
  const snap = await db.getSnapshot();
  const { rows, queue, summary } = buildDesk(snap);
  console.log(`${label.padEnd(26)} queue=${String(queue.length).padStart(2)} collected=${formatCents(summary.collectedCents).padStart(9)} outstanding=${formatCents(summary.outstandingCents).padStart(10)} aliases=${snap.aliases.length}`);
  return { snap, rows, queue };
};

async function main() {
  await db.loadSampleCredits!();
  let { snap, rows, queue } = await show('seeded');

  // 1. Confirm the app's guess on the nickname case — should learn an alias.
  const nick = queue.find((q) => q.reason.includes('same name'))!;
  await db.applyCredit({
    txnId: nick.txn.id,
    allocations: [{ memberId: nick.candidates[0].memberId, amountCents: nick.txn.amountCents }],
    learnAliasFor: nick.candidates[0].memberId,
    reason: nick.reason,
  });
  ({ snap, rows, queue } = await show('confirmed nickname'));
  console.log(`   learned: ${snap.aliases.map((a) => `${a.bankName} → ${snap.members.find((m) => m.id === a.memberId)?.name}`).join(', ')}`);

  // 2. Split the doubled credit across two brothers.
  const split = queue.find((q) => q.split)!;
  const other = rows.find((r) => r.memberId !== split.candidates[0].memberId && r.balanceCents > 0)!;
  await db.applyCredit({
    txnId: split.txn.id,
    allocations: [
      { memberId: split.candidates[0].memberId, amountCents: split.txn.amountCents / 2 },
      { memberId: other.memberId, amountCents: split.txn.amountCents / 2 },
    ],
    learnAliasFor: split.candidates[0].memberId,
    reason: split.reason,
  });
  ({ snap, rows, queue } = await show('split across two'));

  // 3. Reverse the returned credit; the brother goes back to unpaid.
  const ret = queue.find((q) => q.tier === 'return')!;
  const returnedId = ret.candidates[0].memberId;
  const before = rows.find((r) => r.memberId === returnedId)!;
  await db.reverseCredit(ret.txn.id, returnedId);
  ({ snap, rows, queue } = await show('reversed a return'));
  const after = rows.find((r) => r.memberId === returnedId)!;
  console.log(`   ${before.name}: ${before.status} ${formatCents(before.balanceCents)} → ${after.status} ${formatCents(after.balanceCents)}`);

  // 4. A double-apply must be refused, not silently double-counted.
  const applied = snap.payments.find((p) => p.bankTxnId !== 'seed')!;
  try {
    await db.applyCredit({
      txnId: applied.bankTxnId,
      allocations: [{ memberId: applied.memberId, amountCents: applied.amountCents }],
      learnAliasFor: null,
      reason: 'double submit',
    });
    console.log('   DOUBLE-APPLY WAS ALLOWED — mock store is missing the guard');
  } catch (e) {
    console.log(`   double-apply refused: ${(e as Error).message}`);
  }

  // 5. Undo a payment — the credit returns to the queue.
  await db.undoPayment(applied.id);
  ({ snap, rows, queue } = await show('undid a payment'));

  // 6. Opportunity fund: covering dues without pretending money arrived.
  const aided = rows.find((r) => r.status === 'unpaid')!;
  await db.grantOppFund({ memberId: aided.memberId, amountCents: 45000, reason: 'Financial aid' });
  ({ snap, rows } = await show('granted opp fund'));
  const now = rows.find((r) => r.memberId === aided.memberId)!;
  console.log(`   ${now.name}: owed ${formatCents(now.owedCents)} (opp fund ${formatCents(now.oppFundCents)}), status ${now.status}`);
}

main();
