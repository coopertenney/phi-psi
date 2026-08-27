# Cal Beta Dues Desk

Standalone dues tracker for Phi Kappa Psi Cal Beta. Reads the chapter's bank
account, matches incoming credits to brothers, tracks who still owes what.

Separate app from `chapter-app/` — own repo, own backend. The chapter app's
Finances tab keeps running untouched; the two ledgers are independent.

Visual/interaction reference: `dues-desk.html` (self-contained, mock data,
resets on refresh — same convention as `phi-kappa-psi-dashboard.html`).

## Stack (planned)

Next.js 14 App Router + TypeScript strict + Supabase (new project) + Plaid
(read-only transactions). Hosting: Vercel. PWA, installable — mirror
`chapter-app`'s `public/sw.js` (push-only, no `fetch` handler, caches nothing).

## Two findings that shape the whole design (Aug 27)

- **No public Zelle API.** Zelle is Early Warning Services, owned by a bank
  consortium; the only Zelle APIs are sold to financial institutions through
  core providers (Jack Henry/Banno, FIS, Fiserv). No developer program, no
  sandbox, no third-party path. The bank feed isn't a workaround, it's the
  only read path that exists. Don't re-litigate this.
- **Zelle memos never reach bank transaction data.** Statements carry
  counterparty name + amount + date only. The note the sender types stays
  inside Zelle and the bank's portal. So "tell brothers to put `fall dues` in
  the memo and parse it" is impossible. **The matcher has name + amount and
  nothing else** — which is why the review queue is the product, not a
  fallback. Everything else is plumbing.

## Key design decisions

- **Scope: dues only** (Aug 27) — no points/attendance (that's a separate
  standalone app, see its own spec), no recruitment/socials/announcements.
- **Bank feed, not Zelle** (Aug 27) — see above.
- **Provider: Plaid, with a caveat** (Aug 27) — chosen for
  `original_description` (the raw `ZELLE PMT FROM …` string the parser needs;
  requires `include_original_description`), `counterparties[]`, and
  `/transactions/sync` cursor semantics that report **removed** and
  **modified** transactions — needed so a reversed payment can't silently stay
  credited. **Caveat:** the original tiebreaker was Plaid's OAuth (treasurer
  logs in at their own bank, never hands over credentials), but Stanford FCU
  appears to be **credential-based** on Plaid, not OAuth. That weakens the
  argument vs Teller ($0.30/enrollment/month, free under 100 connections,
  published pricing, self-serve). **Revisit before committing.** Keep all
  aggregator calls behind `lib/bank/provider.ts` returning a normalized
  `BankTxn` so the swap stays cheap — this is also the mock/live seam, same
  pattern as `chapter-app`'s `lib/data/index.ts`.
- **Chapter-owned account, confirmed** (Aug 27) — the receiving account is in
  the chapter's name, not a brother's personal account. This was the blocking
  prerequisite: Plaid sees *every* transaction in the account it connects to,
  so a personal account would pipe someone's rent and paychecks into a chapter
  app, unfilterable (the raw feed arrives before any filter runs). Resolved —
  don't reopen unless the account changes.
- **Fresh backend, ledger starts at zero** (Aug 27) — new Supabase project,
  no import of `chapter-app`'s `dues_charges`/`payments` history.
- **Exec-only login** (Aug 27) — execs authenticate to review and apply
  payments. Members get a read-only "what do I owe" view, no accounts. Same
  model as the points app.
- **Nothing auto-applies in phase 2** — every matched credit lands in the
  queue first. Auto-apply above a confidence threshold comes only after match
  quality has been watched against reality for a few weeks.
- **Every automatic match is reversible from the UI**, and each carries a
  visible audit trail of what matched and why. An exec must be able to answer
  "why does the app think Bobby paid?" in one click.

## Data model (planned)

| Table | Notes |
|---|---|
| `members` | name, `aka[]` (learned bank-name variants), photo optional. No `auth_user_id` — members don't log in |
| `dues_charges` | what each brother owes, per term |
| `bank_txns` | normalized feed rows; `provider_txn_id` **unique** (idempotency), `pending` flag, `removed_at` for reversals |
| `payments` | a `bank_txn` applied to a member/charge; **unique on `bank_txn_id`** so one credit can never double-count |
| `match_candidates` | the review queue: txn + ranked guesses + confidence + reason string |
| `name_aliases` | confirmed `bank string → member` pairings; what makes the queue shrink over time |
| `sync_state` | Plaid cursor, item/access token |

Follow `chapter-app`'s **raw facts, derived numbers** rule: no stored totals.
Balances come from `dues_charges` − applied `payments` in a view.

## The matcher (`lib/match.ts`) — this is the actual work

Input: `original_description` + amount. Output: ranked candidates + confidence
+ a human-readable reason (the reason string is shipped to the UI, not just
logged — see `dues-desk.html`).

- **Name**: strip the institution's Zelle prefix (varies by bank — needs one
  redacted real SFCU example, still missing), normalize case / punctuation /
  middle initials / suffixes, then fuzzy-match against `members.name` **and**
  `name_aliases`. Nickname divergence is systematic, not random ("Bobby" vs
  `ROBERT M SMITH JR`), so alias learning is core, not an optimization.
- **Amount**: with no memo, amount is the only signal for *which* charge is
  being paid. Exact match to an outstanding charge → high confidence.
  Otherwise partial / overpay / multi-brother → queue.
- **Confidence tiers**: `clear` / `check` / `unclear`, plus `return` for
  reversals. Refuse to guess between tied candidates — surface both.
- **Cases the queue must handle** (all real, all in the mockup): exact match;
  nickname or legal-name divergence; a parent paying (sender matches nobody);
  one payment covering two brothers (exact multiple of dues); partial payment;
  two brothers who fit the same truncated name; a non-dues credit; a returned
  payment reversing one already applied.
- **Pending vs posted**: pending credits are provisional — "payment seen, not
  settled". Only settled credits mark paid in full. A `removed` transaction
  must reverse its `payments` row and return to the queue, never delete quietly.

## Phasing

1. **Manual ledger + review queue, no bank connection.** ← start here.
   Independently useful, ships fast, de-risks the matching UX before any API
   dependency, and can be built while Plaid production access is pending.
   `dues-desk.html` is the target UX for this phase.
2. **Plaid read-only sync into the queue.** Nothing auto-applies; watch match
   quality against reality.
3. **Auto-apply above a confidence threshold.**
4. **Optional Gmail memo enrichment** — Zelle's own notification email to the
   receiving account is *believed* to include the memo, unverified. Gated on a
   by-hand check: send a $1 Zelle with a memo, see if the memo appears in the
   email. Bank data stays authoritative for money; email only enriches
   matching. Do not build until verified.

## Worth copying from `chapter-app` rather than re-deriving

- `lib/stripe-record.ts` → `recordCheckoutPayment()` is already
  idempotent-by-payment-id; the `bank_txn` applier needs exactly that shape.
- `app-foundation/payments-idempotency.sql` — the unique-index approach.
- `lib/session.ts` — existing dues/fines derivation, so the two apps' math agrees.
- `components/FinancesScreen.tsx` — dues table + stat cards, for visual continuity.
- `useEscapeKey.ts`, `form.tsx` (`Modal` portals to `document.body`), and the
  `NEXT_DIST_DIR=.next-verify` build gotcha all still apply.

## Still open

- [ ] Confirm SFCU's Zelle **receive limit** on the chapter account — dues
      season is a lot of money in a short window.
- [ ] Get one **redacted real SFCU Zelle descriptor** — prefix and name order
      vary by institution; the parser can't be written without it.
- [ ] Decide Plaid vs Teller for real, given SFCU is credential-based on Plaid.
- [ ] Are checks / cash / Venmo tracked in the same ledger (exec enters them
      by hand alongside matched credits), or bank credits only?
- [ ] Roster size, dues amount, and payment schedule (lump vs installments) —
      drives how much the amount signal can disambiguate. Mockup assumes
      12 brothers at $450/term.
