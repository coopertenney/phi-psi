# Cal Beta Dues Desk

Standalone dues tracker for Phi Kappa Psi Cal Beta. Reads the chapter's bank
account, matches incoming credits to brothers, tracks who still owes what.

Separate app from `chapter-app/` — own repo, own backend. The chapter app's
Finances tab keeps running untouched; the two ledgers are independent.

Visual/interaction reference: `dues-desk.html`, in this folder (self-contained,
mock data, resets on refresh — same convention as `../phi-kappa-psi-dashboard.html`).
The built app copies its tokens, type scale, and confidence colors verbatim.

## Status: phase 2 built, mock backend only (Aug 30 2026)

The ledger, the review queue, the matcher **and the Plaid sync** work end to end
against the in-memory store and the practice feed — `npm run dev`, then **Check
for new payments** on `/` or `/bank`. A CSV importer was built and deleted the
same day (see the decisions below). No Supabase project and no Plaid account
exist, so nothing is live and no real dues data exists; `schema.sql` is written
but has never been applied.

The practice feed (`lib/bank/mock-provider.ts`) is not a stub — pressing the
button three times walks credits arriving, a pending credit settling, and the
bank taking one back, so ordinary local development exercises promotion,
reversal and idempotency rather than only the happy path.

## Stack

Next.js 14 App Router + TypeScript strict + Supabase (project not created yet)
+ Plaid or Teller later (read-only transactions, phase 2). Hosting: Vercel.
PWA is not wired yet — when it is, mirror `chapter-app`'s `public/sw.js`
(push-only, no `fetch` handler, caches nothing).

| Path | Role |
|------|------|
| `lib/backend.ts` | The `DuesBackend` interface — the mock/live seam, and later the Plaid writer's shape |
| `lib/db.ts` | One switch: env vars present → Supabase, absent → mock store. Pages never branch themselves |
| `lib/match.ts` | The matcher: descriptor parsing, fuzzy name scoring, tiers, and the reason strings the UI shows |
| `lib/autoapply.ts` | Applies only the credits the matcher is certain of; everything else queues |
| `lib/bank/sync.ts` | `runSync()` and `partitionFeed()` — the orchestrator, the lock, and the cursor ordering. Every trigger funnels here |
| `lib/bank/provider.ts` | One switch: Plaid credentials present → Plaid, absent → the practice feed |
| `lib/bank/plaid.ts` | The only file that talks to Plaid. Sign flip, `original_description`, update-mode link tokens |
| `lib/bank/token-store.ts` | The only module that names `sync_state.access_token`. `withAccessToken()` passes it into a callback and never returns it |
| `lib/bank/store.ts` | Which `SyncStore` a run persists to — Supabase or memory |
| `app/api/cron/sync/route.ts` | The daily pull. `CRON_SECRET` bearer; never throws |
| `app/bank/` | Connect, reconnect, auto-apply setting, and the run history |
| `lib/ledger.ts` | Derives balances, queue, and summary from raw rows — no stored totals. Home of the oldest-unpaid-term-first payment waterfall |
| `lib/mock-store.ts` | In-memory backend. State hangs off `globalThis`: Next compiles a server bundle per route in dev, so module-level state gives `/settings` its own empty copy |
| `lib/sample.ts` | The `dues-desk.html` walkthrough rebuilt against the real roster |
| `lib/roster.ts` | 105 brothers, forked from `../chapter-app/lib/data/mock.ts` |
| `scripts/check-matcher.ts`, `scripts/check-flow.ts` | `npx tsx` harnesses for the matcher and the write paths |
| `scripts/check-fuzzy.ts` | Every descriptor shape the matcher must resolve — and the ones it must refuse |
| `scripts/check-sync.ts` | The feed end to end: the debit filter, promotion, reversal, re-sync, the lock |
| `scripts/check-aid.ts` | The name resolver, and that the aid flag changes who is chased and nothing about the money |
| `scripts/check-terms.ts` | Three terms at three prices: oldest-first, the spill, a term he was abroad for, undo, the bank's reversal, and re-runs |
| `lib/aid.ts` | Pasted names → roster members, reusing `scoreName` from the matcher |

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

- **Financial aid is a flag, not a discount** (Aug 30 2026) — `members.financial_aid`
  keeps a brother off the follow-up list and changes nothing else: he is still
  charged, still owes, and still counts in the chapter's outstanding total.
  Covering someone's dues stays a separate deliberate act (an `adjustments` row),
  so "collected" never quietly starts meaning something else. The list is pasted
  in as names, one per line, and resolved through the same `scoreName` the bank
  matcher uses — with a confirmation step, because flagging the wrong brother
  stops him being asked to pay and nobody notices a follow-up list that is too
  short.
- **Abroad is an exemption, financial aid is a flag** (Aug 31 2026) — two
  different things and they must not be conflated. A brother abroad is **not
  charged at all** for that term: `exemptions` holds `(member_id, term_id)`, and
  `issueCharges` skips him, so he owes nothing and reads as `exempt` — never as
  `paid`, which would make "collected" look like money that arrived. Per term,
  because being abroad in Winter says nothing about Spring. Financial aid, by
  contrast, changes no number at all — he is still charged, still owes, and is
  only kept off the follow-up list.
- **Dues differ per term** (Aug 31 2026) — Fall $537, Winter $537, Spring $300.
  Nothing is hardcoded: the amount lives on `terms.dues_cents` and an exec types
  it in. `terms.starts_on` orders terms honestly (creation order is not the same
  thing) and gives the bank connection its start date.
- **A payment settles the oldest unpaid term first** (Aug 31 2026) — and spills
  forward into later terms when it is large enough. Owing Fall $537 and Winter
  $537, $1074 comes out square on both and $700 clears Fall and puts $163 on
  Winter. This replaced a single-term ledger that was quietly wrong twice over: a
  brother paying his Fall dues in January had the money stamped with the current
  term, so Fall stayed unpaid forever and Winter read as settled by money that was
  never meant for it.
  - **The allocation is derived at read time and never stored** (`lib/ledger.ts`).
    Which term a payment settles depends on every other payment, charge, grant and
    exemption that brother has, so a stored allocation is a stored total wearing a
    different hat — it would go stale the moment anything upstream moved, and
    `undoPayment` would leave the surviving payments pointing at terms they no
    longer fill. It is also the only option the schema allows: `payments` is
    `unique (bank_txn_id, member_id)`, so a credit spanning two terms *cannot* be
    written as two rows for one brother. **The payment row stays one raw fact —
    "$700 arrived from him" — and the Fall/Winter split is computed.**
  - `payments.term_id` now means "the term that was current when this was
    recorded", an audit fact about *when*, not a claim about what it settled.
    `charge_id` is null on everything written since, because a payment can span
    two charges and cannot honestly point at one.
  - **What is term-scoped and what is not** is a per-number decision, spelled out
    on `DeskSummary`. Collected / charged / opp fund stay **current term** (they
    are read as a percentage of this term's charges). Outstanding, the follow-up
    list and the settled count became **all terms** — scoping those was the bug.
    The desk shows the split (`$X this term · $Y from earlier terms`) rather than
    silently redefining a number an exec was already reading.
  - **Auto-apply gained a second gate**, `termCertain` beside `nameCertain`:
    knowing whose money it is settles nothing if it then lands on the wrong
    quarter. It fires only when the waterfall has no discretion — one open term,
    or an amount that squares a whole run of terms, or one that covers everything
    he owes. A partial from an unmistakable sender with two terms open used to
    auto-apply and no longer does: $300 against Fall $537 and Spring $300 plainly
    meant Spring, and oldest-first would put it on Fall.
  - `member_balances` was single-term too and now agrees, number for number. It
    needs no term ordering: the per-term split is order-dependent, the totals are
    not, so the view uses plain sums and reimplements nothing.
- **Terms roll over in the app** (Aug 30 2026) — `createTerm` clears the old
  `is_current` before inserting, since `terms_one_current` is a unique partial
  index. Charges are per term; a **balance is not** — see above. The bank
  connection, cursor, learned aliases and aid flags carry over because they
  belong to the chapter, not to a term. `terms.starts_on` orders the terms, which
  is what decides which one a payment settles first, so it is worth typing in;
  an undated term sorts last.

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
- **Plaid is the ingestion path; the CSV importer is deleted** (Aug 30 2026,
  reversing the CSV decision taken hours earlier). Two facts settled it:
  **Stanford FCU is on Plaid** (`institution_id: ins_109990`, transactions
  supported), and Plaid's **Trial plan** — new US teams created on/after Apr 15
  2026 — gives *real production data* free with no production-approval
  application. This app needs exactly one Item.
  - **The cap is lifetime.** Plaid: *"Removing Items created on a Trial plan will
    not allow you to create more Items."* 10 Items, ever, and removal refunds
    nothing. **Re-auth must use Link update mode**, never a fresh link, or the
    annual treasurer handoff burns the allowance. Never call `/item/remove`.
    `client_user_id` must be a constant (`'cal-beta-chapter'`), never an exec's
    uid — a per-exec id makes next year's update-mode link look like a new user.
  - The deleted CSV code is recoverable from the session scratchpad if the
    aggregator path ever stalls; nothing about it is worth rebuilding from
    memory.
- **A `dues-tracker-spec.md` proposed matching a `DUES-####` memo code**
  (Aug 30 2026) — **rejected**, because Zelle memos never reach bank
  transaction data (see the finding above). Its matching premise was never
  built. If a code ever does appear in a real descriptor, the matcher's
  descriptor parser is where it would go.
- **Auto-apply is on, narrowly** (Aug 30 2026, reversing the earlier "nothing
  auto-applies") — the exec's call: clicking confirm on forty obvious rows is
  the manual work the app exists to remove. It fires only at tier `clear` — the
  sender resolves to exactly one brother *and* the amount settles his balance to
  the penny. It was a checkbox on the import screen; with cron running it
  unattended it becomes a per-term setting (`terms.auto_apply`) toggled at
  `/settings`.
  Partials, splits, family payers, initials-only senders, ties, returns and
  pending credits always queue. Every auto-applied payment carries the matcher's
  own reason string and undoes in one click.
- **The fuzzy auto-apply threshold is an accepted risk** (Aug 30 2026, exec
  decision). An adversarial review proved that a *non-brother* whose name is one
  character off a brother's clears the bar: `GRAHAM JOHNSON` scores 0.958 against
  Graham Johnstone (threshold 0.95), runner-up at 0.281, so nothing reads as
  ambiguous. Requiring an exact surname anchor would fix it and roughly halve
  what auto-applies — judged not worth it, since the failure also needs the
  sender to pay exactly what that brother owes, and it is undoable. **This is why
  auto-apply must never learn aliases** (below): the accepted risk is survivable
  only while it stays a one-off. Revisit against real descriptors after a term.
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
- **What "fuzzy" means here**, in the order the evidence is weighed:
  - **Jaro-Winkler, not Levenshtein.** It weights a shared prefix, which is
    exactly how bank truncation behaves, and forgives transpositions a short
    surname can't afford under edit distance.
  - **Truncation** — a sender token that is a ≥4-character prefix of a roster
    token is the same name cut short by a fixed-width descriptor field.
  - **Phonetics** — a trimmed Metaphone catches a surname typed by ear
    (SHAUGHNESSY/SHAUNESSY, SMYTHE/SMITH). Guarded: both names ≥4 characters,
    code ≥3, and the spellings still broadly similar, or short codes collide
    indiscriminately (`TIAO` and the `DE` of `De Silva` both reduce to one
    consonant — that is not a resemblance).
  - **Roster rarity.** A surname nobody else has is near-decisive; one shared by
    three brothers can't carry a confident match on its own. Particles
    (`DE`, `VAN`, `LA`, …) are never indexed as surnames.
  - **Token order is not assumed** — `SMITH ROBERT` and `ROBERT SMITH` are one
    person. Hyphenated surnames index under each part.
  - **Multi-sender descriptors** — `JOHN SMITH AND MARY JONES` is split and both
    halves ranked.
  - **Family inference** — surname anchored, given name belonging to nobody on
    the roster, reads as a parent; confidence comes from the surname being
    unique. Once one relative is confirmed, a *second* relative with that
    surname is recognized from the alias table. Capped below `clear` on
    purpose: which brother a relative is paying for is a human judgment.
  - **Amount as tiebreaker** — when two brothers fit the name equally and only
    one owes exactly this much, that settles it. If both fit, it stays tied and
    the app refuses to guess.
- **Amount**: with no memo, amount is the only signal for *which* charge is
  being paid. Exact match to an outstanding charge → high confidence.
  Otherwise partial / overpay / multi-brother → queue.
- **Confidence tiers**: `clear` / `check` / `unclear`, plus `return` for
  reversals. Refuse to guess between tied candidates — surface both. Three things
  can never reach `clear`, each proven necessary by an adversarial review:
  a **family payer**, an explicit **`SR`** sender (the father, not the brother),
  and a tie the **amount** broke rather than the name — that last one is a
  balance casting a deciding vote, which is enough to rank a guess and never
  enough to move money unattended.
- **Auto-apply never teaches aliases.** A learned alias is permanent and makes
  every later credit from that sender match at 1.00 unquestioned; only a human
  confirmation earns that. `undoPayment` also unlearns what its payment taught —
  without both halves, one wrong auto-apply keeps paying the wrong brother
  forever and undoing the payment does not undo the lesson.
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
2. **Plaid read-only sync into the queue.** ← built (practice feed). `/transactions/sync` behind
   `lib/bank/provider.ts`, cron as the backbone (a cron run is a catch-up run;
   a missed webhook self-heals, a webhook-only design fails silently), a manual
   "Check for new payments" button, and `SYNC_UPDATES_AVAILABLE` as a later
   latency win. The money-critical rules: write the page **before** saving the
   cursor; promote pending→posted in place via `pending_transaction_id`; reverse
   a `removed` through a synthetic mirror `bank_txn`, because
   `unique (bank_txn_id, member_id)` forbids a negative payment on the original.
3. **Widen auto-apply** past tier `clear`, only after match quality has been
   watched against a real feed for a term.
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
      vary by institution. The parser now has a wide prefix list and degrades to
      raw-string matching, but one real example would confirm it.
- [ ] **Confirm SFCU is OAuth or credential-based** on Plaid. `ins_1099xx` is the
      older non-OAuth range, so credential-based is likely — it works, it just
      re-auths more often. One `/institutions/get_by_id` call settles it. If it
      *is* OAuth, a registered `PLAID_REDIRECT_URI` and a `receivedRedirectUri`
      resume path are also needed.
- [x] Plaid vs Teller: **Plaid** (Aug 30 2026). Teller's published coverage is
      thin on credit unions and SFCU support was unconfirmable; Plaid's Trial
      plan is free for one Item.
- [x] Checks / cash / Venmo: **bank credits only** (Aug 26 2026). The one
      non-bank path is the opportunity fund, which reduces what a brother owes
      rather than recording money that never arrived.
- [x] **Dues amount and term cadence** — a per-term amount set at `/settings`,
      and terms are now created in the app rather than by hand in Supabase.
- [ ] Payment schedule (lump vs installments) — drives how much
      the amount signal can disambiguate. Roster is settled: the full 105, forked
      from the chapter app. The amount is a per-term setting an exec types in,
      not a constant; the walkthrough defaults to $450 only to have something to
      divide by. **At 105 brothers all owing the same number, amount barely
      disambiguates at all** — the name is doing nearly all the work, which
      makes alias learning more load-bearing than the 12-brother mockup implied.
- [ ] Deploy: no Supabase project, no Vercel project, no PWA yet.
