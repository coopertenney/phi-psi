# Cal Beta Dues Desk

Standalone dues tracker for Phi Kappa Psi Cal Beta. Reads the chapter's bank
account, matches incoming credits to brothers, tracks who still owes what.

Separate app from `chapter-app/` — own repo, own backend. The chapter app's
Finances tab keeps running untouched; the two ledgers are independent.

Visual/interaction reference: `dues-desk.html`, in this folder (self-contained,
mock data, resets on refresh — same convention as `../phi-kappa-psi-dashboard.html`).
The built app copies its tokens, type scale, and confidence colors verbatim.

## Status: phase 1 built, mock backend only (Aug 26 2026)

The ledger and the review queue exist and work end to end against the in-memory
store — `npm run dev`, then **Load the walkthrough credits** on an empty queue.
No Supabase project has been created yet, so nothing is live and no real dues
data exists. `schema.sql` is written but has never been applied.

## Stack

Next.js 14 App Router + TypeScript strict + Supabase (project not created yet)
+ Plaid or Teller later (read-only transactions, phase 2). Hosting: Vercel.
PWA is not wired yet — when it is, mirror `chapter-app`'s `public/sw.js`
(push-only, no `fetch` handler, caches nothing).

| Path | Role |
|------|------|
| `lib/backend.ts` | The `DuesBackend` interface — the mock/live seam, and later the Plaid writer's shape |
| `lib/db.ts` | One switch: env vars present → Supabase, absent → mock store. Pages never branch themselves |
| `lib/match.ts` | The matcher: descriptor parsing, name scoring, tiers, and the reason strings the UI shows |
| `lib/ledger.ts` | Derives balances, queue, and summary from raw rows — no stored totals |
| `lib/mock-store.ts` | In-memory backend. State hangs off `globalThis`: Next compiles a server bundle per route in dev, so module-level state gives `/settings` its own empty copy |
| `lib/sample.ts` | The `dues-desk.html` walkthrough rebuilt against the real roster |
| `lib/roster.ts` | 105 brothers, forked from `../chapter-app/lib/data/mock.ts` |
| `scripts/check-matcher.ts`, `scripts/check-flow.ts` | `npx tsx` harnesses for the matcher and the write paths |

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
| `adjustments` | opportunity fund: covers dues for brothers on financial aid. Deliberately not a payment, so "collected" keeps meaning money that actually arrived |
| `dues_charges` | what each brother owes, per term |
| `bank_txns` | normalized feed rows; `provider_txn_id` **unique** (idempotency), `pending` flag, `removed_at` for reversals |
| `payments` | a `bank_txn` applied to a member/charge; **unique on `(bank_txn_id, member_id)`** — not on `bank_txn_id` alone, because one credit legitimately splits across two brothers. Same guarantee where it matters: one credit can never be applied to the same member twice. A reversal is a negative row, never a delete |
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

1. **Manual ledger + review queue, no bank connection.** ← built (mock backend).
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
- [x] Checks / cash / Venmo: **bank credits only** (Aug 26 2026). The one
      non-bank path is the opportunity fund, which reduces what a brother owes
      rather than recording money that never arrived.
- [ ] Dues amount and payment schedule (lump vs installments) — drives how much
      the amount signal can disambiguate. Roster is settled: the full 105, forked
      from the chapter app. The amount is a per-term setting an exec types in,
      not a constant; the walkthrough defaults to $450 only to have something to
      divide by. **At 105 brothers all owing the same number, amount barely
      disambiguates at all** — the name is doing nearly all the work, which
      makes alias learning more load-bearing than the 12-brother mockup implied.
- [ ] Deploy: no Supabase project, no Vercel project, no PWA yet.
