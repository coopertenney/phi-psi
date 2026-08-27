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
roster, no charges) and skips auth entirely. Click **Load the walkthrough
credits** on an empty queue to seed the eight cases the matcher has to survive.
State resets when the dev server restarts.

To run against a real backend, copy `.env.local.example` to `.env.local`, fill
in the Supabase URL and anon key, and apply `schema.sql` to that project.

## Routes

| Route | Who | What |
|---|---|---|
| `/` | exec | Summary tiles, hand-entered credits, the review queue, the ledger, learned name matches |
| `/settings` | exec | Term dues amount, charging the roster, opportunity fund grants, the applied-payment audit trail |
| `/balances` | anyone with the link | Read-only "what do I owe" — no bank descriptors, no login |
| `/login` | exec | Sign-in. Accounts are created by hand in the Supabase dashboard |

## Checks

```bash
npx tsc --noEmit
npx tsx scripts/check-matcher.ts   # tier + reason for every walkthrough credit
npx tsx scripts/check-flow.ts      # apply, split, reverse, undo, opp fund, double-apply guard
```
