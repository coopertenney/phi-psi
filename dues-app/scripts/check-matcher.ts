// Quick harness: run the walkthrough credits through the matcher and print the
// tier + reason for each, so the queue's behavior can be checked without a
// browser. `npx tsx scripts/check-matcher.ts`
import { mockBackend } from '../lib/mock-store';
import { buildDesk } from '../lib/ledger';
import { formatCents } from '../lib/money';

async function main() {
  await mockBackend.loadSampleCredits!();
  const snap = await mockBackend.getSnapshot();
  const { queue, summary } = buildDesk(snap);
  console.log(`queue=${queue.length} charged=${formatCents(summary.chargedCents)} collected=${formatCents(summary.collectedCents)}\n`);
  for (const q of queue) {
    const top = q.candidates[0];
    console.log(`[${q.tier.padEnd(7)}] ${formatCents(q.txn.amountCents).padStart(8)}  ${q.txn.rawDescription}`);
    console.log(`           guess: ${top ? `${top.memberName} (${top.score.toFixed(2)})` : 'none'}${q.tied ? ' [tied]' : ''}${q.partial ? ' [partial]' : ''}${q.split ? ' [split]' : ''}`);
    console.log(`           why:   ${q.reason}\n`);
  }
}

main();
