# Phi Kappa Psi — Chapter App

Next.js 14 + TypeScript + Supabase (Postgres + Auth + RLS) + Stripe (dues). Hosting: Vercel.
Visual/interaction reference: `../phi-kappa-psi-dashboard.html` (self-contained, mock data).
Schema + seed: `../app-foundation/schema.sql` + `seed.sql`.

## Stack

- **Next.js 14 App Router** — server components fetch data; client components handle interactivity
- **TypeScript strict** — no `any` in component layer; types live in `lib/types.ts`
- **Supabase** — Postgres + Auth + RLS; exec/member boundary enforced at DB layer
- **Stripe** — dues payments only; store `stripe_payment_intent_id` + status, no card data ever

## File layout

| Path | Role |
|------|------|
| `app/` | App Router pages — `members/` is the real vertical; rest are placeholders |
| `components/AppShell.tsx` | Sidebar + topbar (nav, role toggle, theme switcher) |
| `components/MembersScreen.tsx` | Members table + filters + detail drawer |
| `components/Providers.tsx` | Theme + role context, persisted to localStorage |
| `lib/data/index.ts` | Data layer — switches mock ↔ Supabase via env vars |
| `lib/data/mock.ts` | 12-member seed roster as `MemberRow[]` |
| `lib/supabase/client.ts` | Lazy Supabase singleton; `isSupabaseConfigured` guard |
| `lib/types.ts` | `MemberRow`, `ChapterStats`, `MemberStatus`, `DuesState`, `Role`, `Theme` |
| `lib/format.ts` | `money()`, `initials()`, `tint()`, `statusBadge()`, `duesBadge()` |
| `app/globals.css` | Design tokens + full component CSS class library |
| `components/icons.tsx` | 9 SVG icons as React JSX |
| `components/ui.tsx` | `Avatar` (deterministic tint) + `Badge` |

## Key design decisions

- **Mock/live toggle** — `lib/data/index.ts` checks `NEXT_PUBLIC_SUPABASE_URL` + `_ANON_KEY`; absent → mock seed, present → Supabase. Components are identical either way. (Jun 24)
- **Members screen is the reference vertical** — table, filter chips (All/Active/New/Officers), detail drawer (scrim + slide-in, stats mini-cards, recent activity). Every other screen follows this pattern. (Jun 24)
- **Theme + role persistence** — `Providers.tsx` sets `document.documentElement.dataset.theme` in `useEffect` and writes to localStorage so it survives SSR navigation. Three themes: `cardinal`, `hunter`, `heritage`. (Jun 24)
- **`access_role` vs `position`** — schema splits permissions (`exec`/`member`/`admin`) from display title (e.g. "President"). Don't conflate them.
- **Cyclable term marker** — the sidebar "current term" is advanced one quarter at a time by admin via `Providers` state (`termOffset`, localStorage `pkp-term-offset`), computed off `BASE_TERM`/`advanceTerm` in `lib/calendar.ts`. Label-only: does NOT re-scope points/dues/attendance (those stay derived from `NOW`). Live seam: `terms.is_current`. (Jul 5)
- **Appoint exec (succession)** — admin-only "Appoint exec" in `MembersScreen` opens a per-office slate modal (`EXEC_OFFICES` in `lib/nav.ts`). Confirming grants the President `access_role='admin'`, others `exec`+title, and auto-demotes any current officer not in the slate back to member. Live write = `appointExec` in `app/members/actions.ts` (admin-guarded; grants slate first, demotes self last; TODO: memberships role-update RLS). Permissions themselves stay editable anytime on the Access screen. (Jul 5)
- **`security_invoker = on` on views** — `member_standings` and `member_finances` views use this so they don't bypass base-table RLS. `chapter_stats` is intentionally definer (aggregate only, no per-row secrets).
- **Profiles decoupled from auth** — `profiles.auth_user_id` is nullable; a profile exists before a login. Simplifies seeding and onboarding flows.
- **Raw facts, derived numbers** — no stored totals; SQL views compute balances and percentages from `dues_charges`, `payments`, `points_entries`, `attendance`.

## Connect Stripe

See DEPLOY.md's "Adding Stripe" section for the full walkthrough (account,
webhook, env vars). Quick summary: run `stripe-dues.sql`, set
`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `SUPABASE_SERVICE_ROLE_KEY` in
`.env.local` (and Vercel), then flip the Finances-tab toggle on.

## Connect Supabase

1. Create Supabase project, run `../app-foundation/schema.sql` then `seed.sql`
2. Add `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   ```
3. Verify: query `chapter_stats` — expect 11 active/12 total, 6/3/3 dues split, 65% collected

## Stripe (dues payments) — wired

`app/api/stripe/checkout/route.ts` creates a Checkout Session (card + US bank
debit) for the signed-in member's dues balance or fines; `app/api/stripe/webhook/route.ts`
verifies the signature and writes the resulting `payments` row via the
service-role client (`lib/supabase/admin.ts` — bypasses RLS, since a webhook
has no user session). No card data ever reaches our DB, only
`stripe_payment_intent_id` + status, per schema.sql.

Gated by **`chapters.dues_payments_enabled`** (`app-foundation/stripe-dues.sql`),
a chapter-wide switch the Finance Officer flips from the Finances tab (exec
view). Off by default — the FO's Stripe account isn't always ready right when
a new officer takes over each year, so this lets the app (and Zelle/manual
payments) keep working until it's linked, without a code change. Both the UI
(`PayButton` in `FinancesScreen.tsx`) and the checkout route check this flag —
the route is the real gate, the UI is just so members see "ask your
treasurer" instead of a broken button.

## Screens (following Members pattern)

- [x] **Finances** — dues table by brother, 3 stat cards (collected/outstanding/overdue); Stripe Checkout wired (card + ACH), gated by the FO on/off switch
- [x] **Socials** (was Events) — narrowed to `social`+`brotherhood`; week-grouped agenda timeline; exec create/edit + RSVP drawer, member RSVP + history. `/events`→`/socials`. Meetings/attendance moved off (deferred, see ROADMAP); philanthropy/service orphaned for now.
- [x] **Points & Attendance** — one tab (`/points`, label "Points & Attendance") rendering the `PointsScreen` and `AttendanceScreen` side by side via `.pkp-pa-grid` (stacks < 1080px). Exec: points leaderboard + meeting grid; member: points breakdown + attendance strip. `/attendance` redirects to `/points`.
- [x] **Announcements** — audience-gated feed + exec compose
- [x] **Dashboard** — officer view (events/announcements/leaders/flags); member dues + standing
- [x] **Recruitment / Rush CRM** — exec funnel + pipeline table + stage controls; member rate/vote/note (`/recruitment`)
- [ ] **Live Supabase wiring** — next: real reads/writes + RLS for the new tables (everything below is mock-only)

`lib/engagement.ts` (events/attendance), `lib/recruitment.ts` (rush), and
`lib/points.ts` (accountability) are the pure analogs of `lib/session.ts`
(dues/fines): deterministic derivations + constants, no data imports. Seed *rows*
stay in `lib/data/mock.ts` behind the data seam; the helper modules hold only the
pure functions applied to them (`memberAttendance`, `rsvpFor`, `pnmNotes`,
`memberPointTotal`, `weekChange`, …). Attendance % and `member.points` are both
*derived* from raw facts (`mockAttendance`, `mockPointEntries`), not stored.

`lib/points.ts` is a direct port of the chapter's Google-Sheet accountability
tracker: an item catalog (`POINTS (items)`) + a points log (`POINTS (log)`) →
per-member total = `MAX(-5, Σ entries)` (the sheet's `POINTS (tracker)!B` core),
with the leaderboard's weekly change as the SNAPSHOT-delta analog. Deferred
(`TODO(fast-follow)`): attendance/dues/sigs penalties + threshold perks — confirm
the two double-counting quirks flagged in that file before adding them.

Action buttons are wired with real client behavior (ephemeral until live):
Add/Edit member, Add charge/fine, Create/Edit event, Add PNM, and Log points all
open `components/form.tsx` modals (`Modal`/`Field`/`Select`/…) that write to local
screen state; Export does a real CSV download (`downloadCsv`); Message and Send
reminder are `mailto:` links; the topbar `components/SearchBox.tsx` searches the
roster and jumps to a member (via `sessionStorage['pkp-focus-member']`, which
`MembersScreen` reads on mount). All such writes — plus RSVP, check-in, compose,
rating/vote/note, stage moves, logging points — are session-local until Supabase
is wired.

## RLS still needed

`schema.sql` covers `memberships`, `dues_charges`, `payments`, `announcements`. Still needs the
tables behind the verticals built on mock data: `events`, `rsvps`, `meetings`, `attendance`,
`points_entries`, and recruitment (`pnms`, `pnm_ratings`, `pnm_votes`, `pnm_notes`). Same pattern:
read = `is_chapter_member`, write = `is_chapter_exec`, except self-writable rows — RSVPs, a
member's own PNM rating/vote/note. PNM stage transitions are exec-only. The `lib/data` getters
(`getEvents`/`getPnms`/…) are stubbed to mock with TODOs marking where the live queries plug in.
