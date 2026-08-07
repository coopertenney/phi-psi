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
- **Appoint exec (succession)** — admin-only "Appoint exec" in `MembersScreen` opens a per-office slate modal (`EXEC_OFFICES` in `lib/nav.ts`). Confirming grants the President `access_role='admin'`, others `exec`+title, and auto-demotes any current officer not in the slate back to member. Live write = `appointExec` in `app/members/actions.ts` (admin-guarded; grants slate first, demotes self last), backed by the DB-level `roster_admin_update` RLS policy (`is_chapter_admin(chapter_id)` on both USING and WITH CHECK) — written into `schema.sql` on Jul 5 but only actually applied to the live DB via `app-foundation/appoint-exec-rls.sql` on Jul 13, since it postdated the chapter's initial `schema.sql` seed. Permissions themselves stay editable anytime on the Access screen. (Jul 5, RLS applied Jul 13)
- **Drive document ownership vs. exec turnover (Jul 13)** — separate from the in-app Appoint-exec RLS above: chapter Drive docs (bylaws, budgets, minutes) are owned by individual brothers' *personal* Gmail accounts, which don't get cleaned up on any schedule tied to graduation/turnover — ownership just quietly goes stale. Fix in progress: a persistent chapter-owned account, `pkp.calbeta@gmail.com`, set up to hold ownership instead of any one brother. Full runbook + Plan A/B in `../EXEC-HANDOFF.md` (repo root, outside chapter-app since it's a chapter-ops doc, not app code). Key findings, decided by hand (not automated):
  - Consumer-to-consumer Drive ownership transfer isn't domain-blocked (that concern only applied if using Stanford Workspace accounts, which isn't the case), but two hard floors remain: (1) a transfer must be authorized by the file's *current* owner — no tool/admin path seizes a third party's file, so at best it's one consent click per owner, never a single bulk button; (2) suspected (Cooper to verify by hand) that ownership transfer between personal Gmails only works for native Google types (Docs/Sheets/Slides), not uploaded binaries (PDF/.xlsx/images) — which is most of the actual chapter corpus. Decided: do it by hand, not worth building OAuth automation for the current (small) scope.
  - **Recommended workflow** (not yet built): split into two tiers. (1) *Drive access*, every turnover — officers get added as Editors on the pkp.calbeta-owned folder using their own personal Gmail; Google's native "shared a folder with you" email is the notification, no custom sign-in-link needed. (2) *The account itself*, rarely handed off — one "Drive Steward" role (tied to one anchor office, not the whole board) holds the actual pkp.calbeta password, passed out-of-band (Signal/in-person/password manager) at the rare points that role changes — deliberately never routed through email or the app DB, since a shared secret sitting in Supabase would be readable by more people than should ever see it.
  - **Possible small app addition, not yet built:** after `appointExec` runs, show the Steward a one-time banner listing the newly appointed officers' emails, ready to copy into Drive's share dialog.
- **`security_invoker = on` on views** — `member_standings` and `member_finances` views use this so they don't bypass base-table RLS. `chapter_stats` is intentionally definer (aggregate only, no per-row secrets).
- **Profiles decoupled from auth** — `profiles.auth_user_id` is nullable; a profile exists before a login. Simplifies seeding and onboarding flows.
- **Profile photos** — `components/MemberAvatar.tsx` renders a member's `avatarUrl` (`<img>`) with the initials `Avatar` as fallback. `avatar_url` flows profiles → `member_standings` → `MemberRow` (see `profile-avatars.sql`). Use `MemberAvatar name src` (NOT the bare `Avatar`) anywhere a real member is shown: topbar, Members, Dashboard leaders/flagged, Points leaderboard, Finances rows/drawer, Attendance grid, Socials RSVPs, SearchBox. Kept initials-only where no photo exists: PNMs (`PnmRow` has no avatar), the Finances recent-payments feed (`RecentPayment` = name only), announcement authors (name string), and the Lineage tree (text nodes, no avatar UI). (Jul 9)
- **`PointsLeadersCard` shared** — top-5 leaderboard extracted in `DashboardScreen.tsx`, used by BOTH the officer and member dashboards. The member dashboard is now a two-column `pkp-grid-main` (dues/coming-up left, leaderboard right; `highlightId` bolds the signed-in member's row). (Jul 9)
- **ESC closes every popup** — shared `components/useEscapeKey.ts` hook (`useEscapeKey(onClose, enabled?)`) wired into `Modal` (form.tsx), `Drawer` (ui.tsx — now `'use client'`), `ProfileDialog`, and the AppShell mobile nav. New overlays should call it too. (Jul 9)
- **Dev/build `.next` collision (gotcha)** — running `next build` on the default `.next` while `next dev` also uses `.next` corrupts the dir → dev server crashes and serves STALE/broken bundles (once looked like "pfps not loading" — it was old compiled code). Give each parallel build its own dir: `NEXT_DIST_DIR=.next-verify npm run build`. `next.config.mjs` already honors `NEXT_DIST_DIR`; `tsconfig include` lists the `.next-*` variants. (Jul 9)
- **Raw facts, derived numbers** — no stored totals; SQL views compute balances and percentages from `dues_charges`, `payments`, `points_entries`, `attendance`.
- **Cross-device live sync** (Jul 9) — every device shows the latest without a manual reload. Two parts: (1) `app/layout.tsx` sets `export const dynamic = 'force-dynamic'` + `fetchCache = 'force-no-store'` app-wide so Supabase reads bypass Next 14's fetch Data Cache — the real staleness fix (dynamic *rendering* was already forced by `cookies()`; that alone does NOT bypass the Data Cache, so `router.refresh()` could re-render and still return stale reads in prod). (2) `components/DataRefresher.tsx` (mounted in layout beside `VersionWatcher`) does a soft `router.refresh()` on window `focus` + `visibilitychange`→visible, plus a 60s while-visible poll — so a device left open catches changes made elsewhere. Distinct from `VersionWatcher`, which hard-reloads for a *new build*. **Caveat:** `force-no-store` freshness can't be proven in dev (no Data Cache) — smoke-test on the deploy: change a value on desktop, foreground the phone, watch it update. NOT realtime/push — polling + focus. The installed home-screen PWA updates the same way: `public/sw.js` is **push-only (no `fetch` handler, caches nothing)**, so there's no service-worker cache to serve stale data.
- **Mobile UI polish** (Jul 9) — refinements in the `@media (max-width:860px)` block of `globals.css`. (1) Chapter photo is rendered as a viewport-fixed `body::after` layer on phones instead of `background-attachment:fixed` on `body` (iOS Safari ignores `fixed` and sizes `cover` to the whole document → a giant scrolling crop; the app is an installed iOS PWA). (2) The dark-theme overlay is deepened on mobile (.80/.86) so the busy party photo reads as faint texture and *unbacked* summary stat rows (Finances/Recruitment) stay legible. (3) Topbar masthead is left-aligned next to the hamburger on mobile (`justify-content:flex-start`) — desktop's `space-between` otherwise stranded the title against the right edge once the actions are hidden. **Known gap:** global search (`SearchBox`) is desktop-topbar-only — unreachable on mobile; roster is a tap-through list instead.

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

**Verify-on-return (Jul 9)** — the `payments` write no longer depends only on
the webhook. The checkout success URL now carries
`session_id={CHECKOUT_SESSION_ID}`; `app/finances/page.tsx` calls
`confirmCheckoutOnReturn(session_id)` (`app/finances/actions.ts`) *before*
fetching, which retrieves the session from Stripe, checks `payment_status ===
'paid'`, and records it — so the balance flips to "paid in full" on redirect
with no flash and **no webhook required** (the webhook can't reach `localhost`).
Both paths (webhook + return) call the shared **`lib/stripe-record.ts`
`recordCheckoutPayment()`**, idempotent by `stripe_payment_intent_id`, so they
never double-write. The webhook stays authoritative for ACH/async settlement.

**Demo reset (Jul 9)** — `resetMyDemoDues()` (`app/finances/actions.ts`) deletes
the *signed-in member's own* payments (membership id resolved server-side from
the session, never client-passed) via the service-role client, restoring the
balance so the pay flow can be re-demoed. Shown as a "↺ Reset demo dues" button
on the member Finances view. **Gated by `NEXT_PUBLIC_DEMO_MODE=1`** — checked in
both the UI render and the action — so it's inert in real deploys.

## Screens (following Members pattern)

- [x] **Finances** — dues table by brother, 3 stat cards (collected/outstanding/overdue); Stripe Checkout wired (card + ACH), gated by the FO on/off switch
- [x] **Socials** (was Events) — narrowed to `social`+`brotherhood`; week-grouped agenda timeline; exec create/edit. **RSVPs handled entirely in Partiful** (no in-app RSVP as of Jul 9) — each social carries an optional `partiful_url`; member cards show a primary "RSVP on Partiful ↗" button, exec drawer shows "Open Partiful invite ↗"; past events are a badge-less "Past socials" list. `/events`→`/socials`. Meetings/attendance moved off (deferred, see ROADMAP); philanthropy/service orphaned for now.
- [x] **Points & Attendance** — one tab (`/points`, label "Points & Attendance") rendering the `PointsScreen` and `AttendanceScreen` side by side via `.pkp-pa-grid` (stacks < 1080px). Exec: points leaderboard + meeting grid; member: points breakdown + attendance strip. `/attendance` redirects to `/points`.
- [x] **Announcements** — audience-gated feed + exec compose
- [x] **Dashboard** — officer view (events/announcements/leaders); member dues + standing + points leaders. "Needs attention" flags card cut (Jul 9). Exec "Recent announcements" feed **auto-marks read on view** (Jul 9): mirrors `AnnouncementsScreen`'s `markAnnouncementsRead` batch + `sentRef` pattern, live-only; page passes `myReadIds`/`live` in.
- [x] **Recruitment / Rush CRM** — exec funnel + pipeline table + stage controls; member rate/vote/note (`/recruitment`)
- [ ] **Live Supabase wiring** — next: real reads/writes + RLS for the new tables (everything below is mock-only)

`lib/engagement.ts` (events/attendance), `lib/recruitment.ts` (rush), and
`lib/points.ts` (accountability) are the pure analogs of `lib/session.ts`
(dues/fines): deterministic derivations + constants, no data imports. Seed *rows*
stay in `lib/data/mock.ts` behind the data seam; the helper modules hold only the
pure functions applied to them (`memberAttendance`, `pnmNotes`,
`memberPointTotal`, `weekChange`, …). Attendance % and `member.points` are both
*derived* from raw facts (`mockAttendance`, `mockPointEntries`), not stored.

`lib/points.ts` is a direct port of the chapter's Google-Sheet accountability
tracker: an item catalog (`POINTS (items)`) + a points log (`POINTS (log)`) →
per-member total = `clamp(floor, ceiling, Σ entries)` (the sheet's
`POINTS (tracker)!B` core, floor now configurable), with the leaderboard's weekly
change as the SNAPSHOT-delta analog.

**Admin-customizable points** (Jul 9) — the catalog + engine are exec-editable
in-app from the "Point values" drawer, no SQL required:

- **Catalog CRUD** — add / edit label & value / flip reward↔punishment / reorder
  / **archive** (soft-delete; keeps ledger history since past entries snapshot
  their points and join the label). Actions in `app/points/actions.ts`
  (`createPointItem` / `updatePointItem` patch / `archivePointItem` /
  `reorderPointItems`); RLS `point_items_cud` already covers writes.
- **Engine rules** — chapter-wide `points_floor` / `points_ceiling` /
  `points_reset_each_term` on `chapters` (edited in the drawer's "Scoring rules"
  card) + per-item `max_per_term` cap. Floor/ceiling/reset are applied in the
  **client engine** (`memberPointTotal(entries, id, cfg)`); caps enforced
  server-side in `logPoints`/`requestPoints` (which now also stamp `term_id`).
- **Auto-award (option C)** — an item with `auto_trigger` (an attendance state)
  is awarded automatically by `recordAttendance` (idempotent per meeting via
  `points_entries.meeting_id`) and **removed from the manual Log-points picker**
  — attendance owns it, no double-counting. Plus per-item `self_loggable` /
  `auto_approve` flags (self-log RLS honors them).

Migrations: **`app-foundation/points-catalog-crud.sql`** then
**`points-rules-auto.sql`** — apply BEFORE/with deploying this code (both
`getPointItems` and `getChapterSettings` select the new columns; the getters
degrade to defaults if a column is missing so a code-before-SQL deploy won't 500,
but the features are dark until the SQL runs). Known divergence: the
`member_standings` view (roster column + Dashboard "points leaders") is still the
raw approved sum — it does **not** apply ceiling/reset (floor was always
client-side). Points-tab totals and Dashboard leaders can differ if a
ceiling/reset is set; make the view config-aware if that matters.

Still deferred (`TODO(fast-follow)` in `lib/points.ts`): the sheet's dues/sigs
penalties + threshold perks — confirm the two double-counting quirks flagged in
that file before adding them.

Action buttons are wired with real client behavior (ephemeral until live):
Add/Edit member, Add charge/fine, Create/Edit event, Add PNM, and Log points all
open `components/form.tsx` modals (`Modal`/`Field`/`Select`/…) that write to local
screen state. **`Modal` portals to `document.body`** (Jul 9) so its fixed overlay
(`z-index:200`) escapes the main content's stacking context (`z-index:1`) —
otherwise tall modals render *below* the topbar (`z-index:5`) and get clipped;
mount-gated to avoid an SSR hydration mismatch. Export does a real CSV download (`downloadCsv`); Message and Send
reminder are `mailto:` links; the topbar `components/SearchBox.tsx` searches the
roster and jumps to a member (via `sessionStorage['pkp-focus-member']`, which
`MembersScreen` reads on mount). All such writes — plus check-in, compose,
rating/vote/note, stage moves, logging points — are session-local until Supabase
is wired.

## RSVPs = Partiful only (Jul 9)

There is **no in-app RSVP** — RSVPs are handled entirely in Partiful. Each social
carries an optional normalized `events.partiful_url` (`app-foundation/events-partiful.sql`);
the app just surfaces the link. Removed this session: the `rsvps` table + `rsvp_status`
enum + seed RSVPs + rsvps RLS (from `schema.sql`/`seed.sql`/`events-live.sql`), the
`RsvpState` type + `EventRow.rsvp`, `getEventRsvps`/`EventRsvp`/`RSVP_IN`, `setRsvp`,
`rsvpFor`, and all RSVP UI (buttons, bar, guest list, drawer stats, history badges,
dashboard "going" counts). **To drop the live table**, run `app-foundation/rsvps-drop.sql`
(additive migration; the app already ignores the table so it's optional/non-blocking).

## RLS still needed

`schema.sql` covers `memberships`, `dues_charges`, `payments`, `announcements`. Still needs the
tables behind the verticals built on mock data: `events`, `meetings`, `attendance`,
`points_entries`, and recruitment (`pnms`, `pnm_ratings`, `pnm_votes`, `pnm_notes`). Same pattern:
read = `is_chapter_member`, write = `is_chapter_exec`, except self-writable rows — a
member's own PNM rating/vote/note. PNM stage transitions are exec-only. The `lib/data` getters
(`getEvents`/`getPnms`/…) are stubbed to mock with TODOs marking where the live queries plug in.
