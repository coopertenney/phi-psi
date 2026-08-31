# Cal Beta Dues Desk

Standalone dues tracker for Phi Kappa Psi Cal Beta. Working notes, decisions,
and open questions live in `CLAUDE.md`; the pre-build spec is
`../phi-psi-dues-app-spec.md`; the visual reference is `dues-desk.html`.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

With no `.env.local`, the app runs on an in-memory mock store (105-member
roster, no charges) and skips auth entirely, and the bank connection runs on a
practice feed. Set a dues amount under **Term & charges**, charge the roster,
then press **Check for new payments** three times: the first brings in the eight
cases the matcher has to survive, the second settles a pending payment, and the
third has the bank take one back. State resets when the dev server restarts.

To run against a real backend, copy `.env.local.example` to `.env.local`, fill
in the Supabase URL and anon key, and apply `schema.sql` to that project.

## Routes

| Route | Who | What |
|---|---|---|
| `/` | exec | Summary tiles, the bank check, the review queue, the ledger, learned name matches |
| `/bank` | exec | Connect or reconnect the chapter account, the auto-apply setting, and what each check found |
| `/settings` | exec | Term dues amount, charging the roster, opportunity fund grants, the applied-payment audit trail |
| `/balances` | anyone with the link | Read-only "what do I owe" — no bank descriptors, no login |
| `/login` | exec | Sign-in. Accounts are created by hand in the Supabase dashboard |

## Checks

```bash
npx tsc --noEmit
npx tsx scripts/check-matcher.ts   # tier + reason for every walkthrough credit
npx tsx scripts/check-flow.ts      # apply, split, reverse, undo, opp fund, double-apply guard
npx tsx scripts/check-fuzzy.ts     # every descriptor shape the matcher must resolve — and refuse
npx tsx scripts/check-sync.ts      # the bank feed: debits, promotion, reversal, re-sync, the lock
npx tsx scripts/check-aid.ts       # name resolution, and that the aid flag never moves money
```

## How a credit finds its brother

A bank credit arrives with a sender name, an amount, and a date. There is no
memo — Zelle's note never reaches bank transaction data — so the name is doing
nearly all the work, and it arrives mangled: truncated by a fixed-width field,
spelled by ear, in legal form, or sent by somebody's mother.

The matcher (`lib/match.ts`) handles nicknames, bank truncation, transposed
letters, names that sound alike, reversed token order, hyphenated surnames, two
senders in one descriptor, and family payers — weighted by how rare each name is
on this roster, because a surname nobody else has means far more than one three
brothers share. It ends with a ranked guess, a confidence tier, and a sentence
in plain English explaining itself, which the UI shows verbatim.

What it will not do is guess between two brothers who fit equally well. That
credit goes to the queue with both names, and the exec's correction is learned:
the sender string is stored against that brother and matches instantly forever
after. **The queue getting shorter every term is the product.**
