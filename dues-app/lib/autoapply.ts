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
//   - a tie between two brothers, a likely split
//   - anything that would leave one of two open terms part-paid: with Fall and
//     Spring both open at different prices, "which quarter did he mean" is a
//     judgment, and getting it wrong is invisible
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
  // The other half of the question, and the one multiple open terms introduced:
  // knowing whose money it is settles nothing if the money then lands on the
  // wrong quarter. `termCertain` (lib/match.ts) is true only when the
  // oldest-unpaid-first waterfall has no discretion left — he owes on at most
  // one term, or the amount squares a whole run of terms, or it covers
  // everything he owes. See below for what that deliberately gave up.
  if (!item.termCertain) return false;
  if (item.txn.amountCents <= 0) return false;
  if (item.txn.pending) return false;      // provisional money isn't settled money
  if (item.tier === 'return') return false;
  if (item.split) return false;            // an exact multiple probably covers someone else
  if (!item.candidates.length) return false;

  const owed = item.candidates[0].outstandingCents;
  if (owed <= 0) return false;             // nothing outstanding to settle

  // What survives, all unambiguous once both the name and the term are certain:
  //   exact   — squares his oldest term, or a whole run of them, to the penny
  //   spill   — covers everything he owes; the excess is flagged as overpaid and
  //             credited to no term at all
  //   partial — only when he has ONE open term, where a short payment has
  //             nowhere else it could have been meant for
  //
  // What this rule gave up, on purpose: a partial payment from an unmistakable
  // sender who owes two terms used to auto-apply. It no longer does, because
  // oldest-first would put it on the older quarter and a brother owing Fall $537
  // and Spring $300 who sends $300 plainly meant Spring. Narrowing auto-apply
  // costs an exec one click; guessing the quarter wrong is silent, and shows up
  // a term later as two wrong numbers instead of one.
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

    // Name the quarter the money landed on. An exec scanning "Applied without
    // asking you" can only check the app's work if the note says which term.
    const term = member.oldestTermLabel;
    const note = q.partial
      ? `Recorded as a partial payment${term ? ` against ${term}` : ''}.`
      : q.overpay
        ? 'More than everything he owes — every open term settled, the rest flagged as overpaid.'
        : term
          ? `Applied to ${term} first, his oldest unpaid term.`
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
