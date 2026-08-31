// Auto-apply, deliberately narrow.
//
// After an import, most of the queue is obvious: a brother whose name matches
// the roster exactly sent exactly what he owes. Clicking "confirm" on forty of
// those is busywork, so this pass applies them and leaves everything else in the
// queue. What it refuses to touch is the point:
//
//   - anything below tier 'clear', which already demands a name the matcher can
//     place on one brother without hedging and an amount that settles his
//     balance to the penny
//   - a tie between two brothers, a partial, an overpay, a likely split
//   - a return, which reverses money and must always be a human decision
//   - two clear credits pointing at the same brother in one file: the second
//     would be applied against a balance the first already settled, so both go
//     to the queue instead
//
// Every payment it writes carries the matcher's own reason string prefixed with
// "Auto-applied", and `undoPayment` puts the credit straight back in the queue —
// so nothing here is a decision an exec can't see and reverse. It also teaches
// the matcher nothing: aliases are learned only from human confirmations.

import type { DuesBackend } from './backend';
import { buildDesk } from './ledger';
import type { QueueItem } from './types';

// Kept in step with the 'clear' tier in lib/match.ts: a fuzzy match the matcher
// is sure of — a truncated surname, a known nickname, one transposed letter —
// is not a match a human would decide differently, and making the exec click
// through those is the manual work this app exists to remove.
// Kept in step with lib/match.ts: `nameCertain` answers "do we know whose money
// this is", and the rules below answer "is the money situation safe to record".
// Splitting those two questions is what lets a partial payment from an
// unmistakable sender be automatic while a full payment from an ambiguous one
// still waits.
export function isAutoApplicable(item: QueueItem): boolean {
  if (!item.nameCertain) return false;
  if (item.txn.amountCents <= 0) return false;
  if (item.txn.pending) return false;      // provisional money isn't settled money
  if (item.tier === 'return') return false;
  if (item.split) return false;            // an exact multiple probably covers someone else
  if (!item.candidates.length) return false;

  const owed = item.candidates[0].outstandingCents;
  if (owed <= 0) return false;             // nothing outstanding to settle

  // Three shapes, all unambiguous once the name is certain:
  //   exact  — settles the balance to the penny
  //   partial— he paid some of it; his balance is simply lower
  //   overpay— more than owed, recorded and flagged rather than left in a queue
  return item.txn.amountCents !== 0;
}

// A credit with no sender name that matches no charge is not dues — it is a
// check deposit, interest, or a fee. Setting it aside moves no money and is
// reversible, so it does not need a human to look at it first.
export function isObviouslyNotDues(item: QueueItem): boolean {
  // Either there is no sender name at all, or the descriptor isn't a transfer
  // from a person in the first place — a check deposit, interest, a fee. Plus
  // nobody on the roster matched and the amount settles nothing. All four
  // together, so a real payment with an unusual descriptor still gets a human.
  return (item.noSender || item.notAPerson)
    && item.candidates.length === 0
    && item.tier === 'unclear'
    && item.txn.amountCents > 0
    && !item.txn.pending;
}

/**
 * Apply every unambiguous credit among `txnIds`, and clear the obvious non-dues
 * ones out of the queue. Returns how many payments were recorded.
 *
 * Reads the ledger once: applying changes what everyone owes, so a member who
 * appears twice in the set is skipped rather than matched against stale balances.
 */
export async function autoApplyClearMatches(
  backend: DuesBackend, txnIds: Set<string>,
): Promise<number> {
  if (!txnIds.size) return 0;

  const snap = await backend.getSnapshot();
  const { queue } = buildDesk(snap);
  const mine = queue.filter((q) => txnIds.has(q.txn.id));

  // Clear the noise first so the exec's queue holds only real decisions.
  for (const q of mine.filter(isObviouslyNotDues)) {
    try {
      await backend.setAside(q.txn.id);
    } catch {
      // A credit that won't set aside simply stays in the queue.
    }
  }

  const eligible = mine.filter(isAutoApplicable);

  const perMember = new Map<string, number>();
  eligible.forEach((q) => {
    const id = q.candidates[0].memberId;
    perMember.set(id, (perMember.get(id) ?? 0) + 1);
  });

  let applied = 0;
  for (const q of eligible) {
    const member = q.candidates[0];
    // Two credits for one brother in the same batch would both be measured
    // against a balance the first already changed.
    if ((perMember.get(member.memberId) ?? 0) > 1) continue;

    const note = q.partial
      ? 'Recorded as a partial payment.'
      : q.overpay
        ? 'More than the balance — recorded in full and flagged as overpaid.'
        : '';

    try {
      await backend.applyCredit({
        txnId: q.txn.id,
        allocations: [{ memberId: member.memberId, amountCents: q.txn.amountCents }],
        // Deliberately null. A learned alias is permanent and self-reinforcing —
        // it makes every future credit from that sender match at 1.00 without
        // question. Only a human confirmation earns that.
        learnAliasFor: null,
        reason: `Auto-applied on sync. ${q.reason}${note ? ` ${note}` : ''}`,
      });
      applied++;
    } catch {
      // A credit that won't apply (someone else got there first, a constraint
      // fired) simply stays in the queue for a human. A sync must never fail
      // because one row was contested.
    }
  }
  return applied;
}
