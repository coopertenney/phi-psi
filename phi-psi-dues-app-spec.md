# Phi Psi — Standalone Dues App
## Spec v1 (pre-build)

**Status:** Draft · **Author:** Cooper Tenney · **Date:** 2026-08-07

## Summary

A treasurer-only web app that tracks what each brother owes in dues and who has
paid, by importing the chapter bank account's transaction export and matching
Zelle deposits to brothers. Third standalone app alongside `points-app/` and
`rollcall-app/`; own Supabase project, no shared tables with the chapter app.

## Problem / Motivation

Dues are collected over Zelle. Nothing reads Zelle — it has no API for
individuals — so the chapter app's Finances tab shows balances that ignore
every payment actually made, and the real number lives in the treasurer's head
and a spreadsheet. Reconciling by hand means opening the bank app, reading
sender names, and ticking names off a list, every week, forever.

The one thing a computer is better at here is remembering that `ROBERT J CHEN`
is Bobby Chen and that `LINDA MARSHALL` is Kevin Marshall's mom. That memory is
the product.

## Goals

- Treasurer uploads a bank CSV; app records the Zelle dues payments in it.
- Every brother has a correct balance: charged minus paid, for the current term.
- Sender-name → brother mappings are confirmed once and reused forever.
- Re-uploading an overlapping date range never double-records a payment.
- A new treasurer can be handed the app each year with no data loss and no
  re-linking of anything.

## Non-Goals

Cut deliberately — the ask was "literally just track dues and who has paid."

- **No member accounts, no member-facing view.** Brothers do not log in and
  cannot look up their own balance. Only the treasurer sees anything.
- **No reminders or notifications.** Chasing people stays a group chat problem.
- **No payment plans.** Partial payments work implicitly (balance goes down by
  what came in); there is no schedule, no installment tracking, no due dates.
- **No fines, event fees, or one-off charges.** Dues only.
- **No card payments / Stripe.** Zelle, cash, and checks only.
- **No bank API integration.** See Alternatives.
- **No roster sync with any other app.** Fresh CSV import; this is the third
  independent copy of the roster and that's accepted.

## Proposed Approach

Mirrors `points-app/` conventions exactly — Next.js 14 App Router, TypeScript,
Supabase (`@supabase/ssr`), auth enforced in `middleware.ts`, hand-created
logins with no signup flow, and an in-memory mock store so localhost renders
before a Supabase project exists (`lib/config.ts` → `isSupabaseConfigured`).

Desktop browser only. No PWA, no manifest, no service worker — the core action
is "download a file from the bank, upload it here," which is a laptop task.

**The loop:**

```
bank site → export CSV → upload → parse → match senders → review → confirm
                                            │
                                   sender_aliases (learned)
                                            │
                                    payments recorded
                                            ↓
                              balance = charges − payments
```

**Auth:** any authenticated user is the treasurer, same simplification as
points-app. Accounts are created by hand in the Supabase dashboard. Unlike
points-app there is no public page, so `anon` gets **no** table access at all —
every policy checks `auth.role() = 'authenticated'`.

**Bank CSVs are never stored.** The upload is parsed in memory in a server
action; only matched payments and a small import summary persist. A bank export
contains the chapter's entire transaction history — rent, food, vendor
payments — and none of that belongs in this database.

## Detailed Design

### Data model (new Supabase project, `schema.sql` at app root)

| Table | Purpose |
|---|---|
| `members` | roster: `id`, `name`, `tier_id`, `active`, `created_at` |
| `dues_tiers` | `id`, `label` (e.g. "Live-in"), `amount_cents`, `sort_order` |
| `terms` | `id`, `label`, `is_current`, `created_at` — one current, same unique-partial-index trick as points-app |
| `charges` | `id`, `member_id`, `term_id`, `amount_cents`, `note`, `created_at` |
| `payments` | `id`, `member_id`, `term_id`, `amount_cents`, `paid_on` (date), `method` (`zelle`/`cash`/`check`/`other`), `source_hash`, `raw_description`, `import_id`, `created_at` |
| `sender_aliases` | `id`, `normalized_name`, `member_id`, `created_at` — unique on `normalized_name` |
| `imports` | `id`, `filename`, `row_count`, `matched_count`, `recorded_count`, `created_at` |
| `settings` | single row: `column_mapping` (jsonb), holds the saved CSV layout |

**Balance** is `sum(charges) − sum(payments)` per member for a term. Computed in
a view (`member_balances`, `security_invoker = on`), not a stored column.

**Adjustments are charge rows, not a feature.** A waiver is a negative
`charges` row with a note; a mid-term move-in is a second positive row. That
covers "partial waivers" and "varies per person" without any extra UI beyond
"add adjustment."

### Charging a term

Treasurer creates a term, then "Charge everyone" writes one `charges` row per
active member at that member's tier amount. Idempotent: skips members who
already have a charge row for that term. Tiers are edited on the roster screen;
changing a tier does not retroactively rewrite existing charges (add an
adjustment instead).

### CSV import

**1. Column mapping.** Bank is a credit union / unknown, so no format is
hardcoded. First upload shows the file's headers and asks which column is the
date, the description, and the amount. Handles both conventions:

- single signed amount column (credits positive, debits negative), or
- separate credit/debit columns.

The mapping saves to `settings.column_mapping` and subsequent uploads skip
straight to review. A "remap columns" link re-opens it if the bank changes.

**2. Filter.** Only credits (money in) are considered. Debits are dropped
before anything is shown — the treasurer never sees chapter spending in this
app.

**3. Sender-name extraction.** Zelle descriptions vary by institution, e.g.
`ZELLE FROM MICHAEL CHEN ON 08/05 REF #ABC123`. Rather than per-bank regexes,
an ordered list of strip patterns removes common prefixes (`ZELLE FROM`,
`ZELLE PAYMENT FROM`, `RECEIVED FROM`) and suffixes (`ON MM/DD`, `REF #…`,
trailing digit runs), then trims. If nothing strips, the raw description is the
candidate and the treasurer corrects it once.

**4. Matching**, in order, against a normalized name (uppercased, punctuation
and middle initials stripped, whitespace collapsed):

| Step | Result |
|---|---|
| `sender_aliases` hit | auto-matched, no confirmation needed |
| exact normalized match to a member name | auto-matched |
| last name matches + first initial matches, or nickname map (Mike↔Michael, Bobby↔Robert, …) | **suggested**, requires confirm |
| nothing | **unmatched** — treasurer picks a brother or marks "not dues" |

Confirming a suggestion or picking a brother writes a `sender_aliases` row, so
the same sender auto-matches on every future import. This is what makes the
second term meaningfully less work than the first.

**5. Review screen.** Three groups — auto-matched, needs confirmation,
unmatched — with amounts and dates. Nothing is written until "Record N
payments." Rows marked "not dues" are discarded, not stored.

### Duplicate protection

Overlapping date ranges are the normal case (treasurer exports "last 30 days"
every week), so re-import must be safe.

`source_hash = sha256(paid_on | amount_cents | normalized_description | occurrence_index)`
with a **unique index** on `payments.source_hash`. The `occurrence_index` is the
0-based count of identical rows *within the same file*, so a brother who
genuinely pays the same amount twice on the same day still gets two rows, while
a re-uploaded file collides on every row and inserts nothing.

Rows whose hash already exists are shown in the review screen as "already
recorded" and excluded from the count.

### Routes

| Route | Screen |
|---|---|
| `/login` | treasurer sign-in |
| `/` | balances — every member, charged / paid / owed, sorted by owed desc |
| `/import` | upload → map columns → review → record |
| `/roster` | members + tiers, CSV import, add/edit/deactivate |
| `/terms` | create term, set tier amounts, charge everyone |
| `/member/[id]` | one brother's ledger: charges, payments, aliases, add manual payment or adjustment |

Manual single-payment entry lives on `/member/[id]` and covers cash, checks,
and Venmo — `method` records which.

### Roster import

CSV with `name` and optional `tier` column. Unknown tier labels are offered for
creation during import. Same one-time-then-edit-in-app model as `rollcall-app`.

### Export

"Export ledger CSV" on `/` — every charge and payment for the term. Serves the
yearly handoff and gives the treasurer something to hand the chapter advisor
that isn't a screenshot.

## Alternatives Considered

| Option | Why not |
|---|---|
| **Plaid / bank API** | Auto-syncs, but stores bank credentials, costs monthly, and must be re-linked at every treasurer change — the exact fragility the yearly handoff is supposed to avoid. |
| **Parse Zelle confirmation emails** to `pkp.calbeta@gmail.com` | Would remove the upload step, but adds inbound-mail infrastructure and a parser that breaks silently when the bank rewords a template. Revisit only if uploading proves annoying. |
| **Manual entry only** | No integration to build, but it's the treasurer's current workload with extra steps, and it never gets easier over time. |
| **Build it into `chapter-app`** | That app is the archive as of Aug 6 (see its CLAUDE.md); dues would then have to move again later. Money must never run in two places at once. |
| **Share the chapter app's Supabase roster** | Avoids a third roster copy, but ties a new app to a frozen one. Accepted the duplication instead. |

## Risks & Open Questions

- **Parent payers are the main failure mode.** `LINDA MARSHALL` pays for Kevin;
  nothing in the name suggests the link. Mitigated by the alias table, but the
  first term still needs the treasurer to resolve them by hand — and a wrong
  confirmation is sticky, since it auto-matches forever. `/member/[id]` lists
  that member's aliases so a bad one can be deleted.
- **Partial payments are indistinguishable from underpayment.** A brother who
  sends half shows as owing half, with no signal about whether that was
  arranged. Accepted — notes on adjustment rows are the workaround.
- **No member visibility means brothers still ask the treasurer** what they
  owe. That's the deliberate v1 trade; a read-only per-member link is the
  obvious v2 if the questions get annoying.
- **Credit-union export format is unverified.** The column mapper is designed
  to absorb this, but the first real file may still reveal something (merged
  columns, multi-row transactions) that needs a fix. Build against a real
  export before calling it done.
- **Open:** does the chapter run one dues charge per quarter or one per year?
  Spec assumes per-term. Changing it is a label change, not a schema change.

## Rollout / Testing

1. Create a fresh Supabase project; run `schema.sql`.
2. Create the treasurer login by hand (Authentication → Users → Add user).
   No signup flow exists.
3. Import the roster CSV; create the tiers; create the current term; charge
   everyone.
4. **Test with a real bank export before trusting it**: verify the column
   mapper reads the credit union's format, that debits are excluded, and that
   re-uploading the same file records zero additional payments.
5. Verify balance math against the treasurer's existing spreadsheet for one
   term. If they disagree, the spreadsheet is right until proven otherwise.

Like points-app, `next build` passing only proves it typechecks — the DB
round-trips and RLS policies aren't exercised until step 1–3 are real.
