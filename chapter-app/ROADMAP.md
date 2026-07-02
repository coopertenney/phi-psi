# Phi Kappa Psi Chapter App — Roadmap & Handoff

Working doc for building out the chapter platform. Pairs with `CLAUDE.md`
(architecture) and `README.md` (run instructions). Pick up at **Step 2**.

> Stack: Next.js 14 (App Router) + TS strict + Supabase (Postgres/Auth/RLS) +
> Stripe (dues, later). Currently on **mock data** — no backend needed to run.
> Data seam: everything goes through `lib/data/index.ts` (mock ↔ Supabase).

---

## Product vision

A Greek-life-specific chapter platform that gets sticky by centralizing dues,
attendance, recruitment, messaging, and analytics. Modern, fast, mobile-first,
role-based (member / officer / admin). Not generic club-management branding.

Business assumptions: chapters renew annually; pricing could be per-member,
per-chapter, university-wide, or processing fees. Leadership turns over often, so
favor speed and simplicity.

---

## The 8 core modules

1. **Member Database / CRM** — profiles: name, grad year, chapter status,
   officer position, contact, big/little lineage, attendance history, point
   totals, payment status, compliance/accountability flags.
2. **Points & Accountability** — categories (social, philanthropy hrs,
   brotherhood attendance, study hrs, recruitment, mandatory events). QR
   check-ins, manual approval, automatic allocation, rule-based deductions,
   member-facing totals.
3. **Event Management** — create/manage events; RSVP + attendance tracking,
   calendar view, push/email reminders, guest lists, live check-in dashboard,
   event analytics.
4. **Recruitment / Rush CRM** — PNM profiles, ratings/scoring, notes, pipeline
   stages, voting, bid tracking, recruitment analytics.
5. **Finance / Dues** — billing, dues tracking, fines, reminders, status
   dashboard, budget visibility, financial reports. Payment processing pluggable
   later.
6. **Communication Layer** — announcements, segmented messages, officer-only
   channels, role permissions, reminders, push-style notifications, member feed.
7. **Analytics Dashboard** — officer dashboards: attendance trends, dues
   delinquency, engagement scores, recruitment funnel, event participation,
   inactive members, compliance risks.
8. **Mobile-First UX** — phone-first check-ins, RSVPs, points, dues, announces;
   officers manage events/attendance/accountability from mobile.

### MVP build order

1. Member database ✅ **done**
2. Events & attendance ✅ **done**
3. Points / accountability ✅ **done**
4. Announcements ✅ **done**
5. Officer dashboard (analytics) ✅ **done**

6. Recruitment / Rush CRM ✅ **done**

7. Dues/finance real Stripe processing ✅ **done** (Checkout, card + ACH, gated
   by the FO's on/off switch — see CLAUDE.md)

Then: 8) Advanced analytics · 9) Mobile app / push · and **wire live Supabase**
(events/rsvps/meetings/points/announcements/**pnms** tables + RLS) — the
biggest remaining unlock, since every write (RSVP, check-in, compose,
rating/vote/note, stage moves) is currently ephemeral client state.

---

## Status

### Done

- **Dashboard** (`/dashboard`) — role-aware. Exec: chapter stat cards (computed
  from roster against quarter dues + fines). Member: own dues front-and-center
  (big balance hero; collapses to a small green "paid in full" pill when
  settled), plus points / attendance / unpaid-fines cards.
- **Members / CRM** (`/members`) — full reference vertical. Table + filter chips
  (All / Active / New / Officers / **Flagged**), row flag dot, detail drawer
  with stats, **Accountability flags**, Details (incl. phone), **Lineage**
  (big/littles), recent activity. Covers all of Module 1.
- **Finances** (`/finances`) — role-aware. Exec: **online-payments on/off
  toggle** (the FO's Stripe switch), stat cards
  (Collected / Outstanding / Unpaid fines), filter chips, dues+fines table,
  per-brother drawer (dues ledger, fines list w/ waive, send reminder / add
  charge / add fine, export). Member: own dues only (balance hero / green paid
  pill), payment history, **fines section**, and a real **Pay dues / Pay
  fines** button that redirects to Stripe Checkout (card or bank debit).
  Quarter dues model. Module 5 complete — see "Stripe (dues payments)" in
  CLAUDE.md and "Adding Stripe" in DEPLOY.md for the wiring + setup steps.
- **Events** (`/events`) — role-aware. Exec: stat cards, filter chips
  (Upcoming / Past / Mandatory / All), event list with RSVP bars, per-event
  drawer (details, RSVP summary, **live check-in** with present toggles, and
  RSVP→attend analytics on past events). Member: upcoming events with working
  RSVP buttons (going/maybe/no) + own attendance history. Covers Module 3.
- **Attendance & Points** (`/attendance`) — role-aware. Exec: avg-attendance /
  points / meetings stat cards, **meeting attendance grid** (12 meetings ×
  roster, present/excused/absent dots) + **points leaderboard**. Member: own
  attendance hero with the 12-meeting strip + points breakdown by category and
  chapter rank. Covers Modules 2 + part of 7.
- **Announcements** (`/announcements`) — role-aware feed (pinned first,
  category badges, author/time). Exec: working **compose** box (title, body,
  category, All/Officers audience) that prepends to the feed; sees officers-only
  posts. Member: all-chapter feed only (officers-only filtered out). Module 6.
- **Dashboard** officer view fleshed out — exec now gets upcoming events, recent
  announcements, points leaders, and a **Needs attention** flag list alongside
  the stat cards. Member view gained a "Coming up" events card. Module 7.
- **Recruitment / Rush CRM** (`/recruitment`, new nav route) — role-aware. Exec
  (recruitment chair): stat cards, **rush funnel** (counts per stage), stage
  filter chips, PNM pipeline table with star ratings + referral, per-PNM drawer
  with profile / ratings / **chapter vote tally** / notes thread / **stage
  controls** (advance → bid → accept / decline, updating the funnel live).
  Member (brother): browse PNM cards + drawer to **rate (stars), vote (bid/pass),
  and add notes**. 12 seeded PNMs across the funnel. Covers Module 4.

### Derived attendance (per the Step 2 note)

`attendancePct` is no longer a seed number — it's **computed from raw attendance
records** (`mockAttendance`: 12 meetings × roster) in `lib/data/mock.ts` via
`memberAttendance()` / `attendancePctFrom()` in `lib/engagement.ts`. Tuned so the
fine/flag thresholds (95 / 80 / 50) land exactly where they did before.

### Points engine — ported from the chapter's Google Sheet (core)

The "Points & Accountability" module is now a real port of the chapter's Google-
Sheet accountability tracker, not a placeholder number. Implemented in
`lib/points.ts`:

- **Item catalog** (`PointItem`) — the sheet's `POINTS (items)` tab verbatim:
  ~20 rewards (GP/VP +30 … formal attire +1), 4 discretionary `?` items (exec
  sets the value), 15 punishments (missing chapter −2 … breaking conduct −15).
- **Log** (`PointEntry`) — every approved entry (member · item · date · approver),
  points denormalized from the catalog, the way the sheet stores it.
- **Member total** = `MAX(-5, Σ logged entries)` — the sheet's
  `POINTS (tracker)!B` core (the **−5 floor** + log sum). `member.points` is now
  *derived* from the log, replacing the old seed number.
- **Leaderboard** — sorted by total; trailing-7-day `weekChange` is the analog of
  the sheet's weekly SNAPSHOT delta; **member of the month** = biggest gainer.
- Surfaced on `/attendance`: exec leaderboard + a **point-values catalog drawer**;
  member **point ledger** (earned vs deductions split, dated entries w/ approver).

**Fast-follow** (the sheet's three adjustments, see `TODO(fast-follow)` in
`lib/points.ts`): attendance penalty (col O), dues penalty, sigs bonus, plus the
threshold perks/punishments. **Confirm two quirks with the user first** — both look
like double-counting: (1) "Missing Chapter −2" / "Late Dues −2" exist in the log
catalog *and* are re-subtracted as the attendance/dues penalties; (2) the
attendance term is `ABS(col O)` where `O = formals×1 − absences×2`, so a member
with more formals than absences still *loses* points (likely a sheet bug).

### Placeholders (ComingSoon)

None — all MVP screens are built. `<ComingSoon>` is unused.

---

## Architecture conventions (follow these)

- **Pattern per screen:** server `page.tsx` calls `lib/data` → passes to a
  client `*Screen.tsx`. Members is the reference; copy it.
- **Role gating:** `useApp()` from `components/Providers.tsx` gives
  `role: 'exec' | 'member'`. Screens branch on it. Current mock identity behind
  the toggle lives in `lib/session.ts` (`MOCK_USER`, `currentMember`). Live mode
  enforces the real boundary via Supabase RLS.
- **Data seam:** add new reads to `lib/data/index.ts` with a mock branch in
  `lib/data/mock.ts`. Never fetch in components.
- **Types:** `lib/types.ts` is the single UI contract (mirrors
  `app-foundation/types.ts`). Add fields there first.
- **Styling:** design tokens + component classes in `app/globals.css`
  (`pkp-card`, `pkp-row`, `pkp-table-head`, `pkp-chip`, `pkp-btn-primary`,
  `pkp-badge`, `pkp-drawer`, `pkp-scrim`). Reuse; don't invent new CSS files.
  Three themes: cardinal / hunter / heritage.
- **Money:** integer cents end-to-end; `money()` in `lib/format.ts` formats.
- **Dues:** quarter system in `lib/session.ts` — Fall/Winter $537, Spring $250;
  `CURRENT_QUARTER = 'spring'`. `duesFor(member)` derives charged/paid/balance.
- **Fines:** `finesFor` / `finesOutstanding` in `lib/session.ts` (mock; live =
  `fines` table, read self/exec, write exec).

### Key files added this session

```
lib/session.ts            identity + quarter dues + fines + ledger helpers
components/DashboardScreen.tsx   role-aware dashboard (replaced static page)
components/FinancesScreen.tsx    exec + member finances, exports <PaidPill>
lib/types.ts              + MemberFlag, FlagSeverity; MemberRow gained
                          phone, bigName, littleNames, flags
lib/data/mock.ts          + lineage (big→little inversion), phones, derived
                          + manual accountability flags
```

### Key files added building Steps 2–5

```
lib/engagement.ts         the "session.ts" for events/points: NOW demo clock,
                          memberAttendance/attendancePctFrom, rsvpFor,
                          attendanceForEvent, pointsBreakdown + POINT_CATEGORIES
lib/types.ts              + EventType/RsvpState/AttendanceState, EventRow,
                          MeetingRow, AttendanceRecord, PointCategory/PointBucket,
                          AnnouncementRow (+ audience/category)
lib/format.ts             + fmtDate/fmtWeekday/fmtTime/relativeDay (pure; takes
                          the NOW anchor as an arg)
lib/data/mock.ts          + mockMeetings, mockAttendance (raw facts; pct now
                          derived), mockEvents (RSVP aggregates), mockAnnouncements
lib/data/index.ts         + getEvents/getEvent/getMeetings/getAttendance/
                          getAnnouncements (mock now; live = TODO behind seam)
components/EventsScreen.tsx        exec list+drawer+check-in / member RSVP+history
components/AttendanceScreen.tsx    exec grid+leaderboard / member strip+breakdown
components/AnnouncementsScreen.tsx feed + exec compose (audience-gated)
components/DashboardScreen.tsx     exec officer dashboard (events/feed/leaders/flags)
app/{events,attendance,announcements,dashboard}/page.tsx   server fetch → screen
```

### Key files added — Stripe dues payments (Module 5)

```
app-foundation/stripe-dues.sql     chapters.dues_payments_enabled + chapters RLS
lib/stripe.ts                      server-only Stripe client singleton
lib/supabase/admin.ts              service-role client (webhook writes, bypasses RLS)
lib/data/index.ts                  + getChapterSettings(), exported CHAPTER_ID
app/api/stripe/checkout/route.ts   creates a Checkout Session (card + us_bank_account)
app/api/stripe/webhook/route.ts    verifies signature, writes payments (idempotent
                                    on stripe_payment_intent_id), handles async ACH events
components/FinancesScreen.tsx      + PayButton, PaymentSettingsCard (FO toggle),
                                    CheckoutBanner (?paid=1/canceled=1)
components/AccessScreen.tsx        Switch exported for reuse
```

### Key files added building Step 6 (Recruitment / Rush CRM)

```
lib/recruitment.ts        FUNNEL + STAGE_META, nextStage, pnmNotes (deterministic),
                          stars helper. Reuses seededUnit from engagement.ts.
lib/types.ts              + PnmStage, PnmNote, PnmRow
lib/data/mock.ts          + mockPnms (12 PNMs across the funnel; ratings/votes
                          derived from an intrinsic score)
lib/data/index.ts         + getPnms / getPnm (mock now; live = TODO behind seam)
components/RecruitmentScreen.tsx   exec funnel+table+stage controls / member cards;
                          shared PnmDrawer (rate / vote / notes)
app/recruitment/page.tsx           server fetch → screen
components/{AppShell,icons}.tsx    new /recruitment nav route + user-plus icon
```

---

## Step 2 — Events & Attendance ✅ built

Goal: brothers RSVP and check in; exec manages events and sees attendance.
Build on the Members pattern. **All of the slice below shipped** — kept here as
the design record. Recruitment / Rush CRM (Module 4) followed the same recipe and
also shipped. Biggest remaining work is **wiring live Supabase** (the data-layer
getters are stubbed to mock with TODOs marking the live queries).

Suggested slice:

1. **Types** (`lib/types.ts`): `EventRow` (id, title, type, startsAt, location,
   description, rsvpCounts, mandatory), `RsvpState = 'going'|'maybe'|'no'|null`,
   `AttendanceState = 'present'|'excused'|'absent'`.
2. **Mock** (`lib/data/mock.ts` + `lib/data/index.ts`): seed ~6 events
   (chapter meeting, philanthropy, social, brotherhood, mandatory risk session),
   plus per-member RSVP/attendance. Add `getEvents()` / `getEvent(id)`.
3. **Events screen** (`app/events/page.tsx` + `components/EventsScreen.tsx`):
   - Exec: list/calendar of events, create-event button (stub), per-event drawer
     with RSVP summary, guest list, and a **live check-in** view (mark present),
     plus simple event analytics (RSVP→attend rate).
   - Member: upcoming events with RSVP buttons; their own attendance history.
4. **Attendance screen** (`app/attendance/page.tsx`): meeting attendance grid +
   ties into points later (Step 3). Could share data with Events.
5. **Mobile:** keep RSVP + check-in tap-friendly (big buttons, single column).

Note: attendance % already shown on members is currently a seed number — Step 2
should make it derive from real attendance records (raw facts → derived numbers,
per CLAUDE.md). Wire `member_standings.attendance_pct` to computed data.

RLS still needed later (see CLAUDE.md): `events`, `rsvps`, `meetings`,
`points_entries` — read = chapter member, write = exec, RSVPs writable by self.

---

## How to run

```bash
cd chapter-app
npm install
npm run dev      # http://localhost:3000 → /dashboard
```

Mock data out of the box. Flip the **Exec / Member** toggle (topbar) to see both
roles. Member demo user = Tyler Brooks (paid, so the green dues pill shows).
Typecheck with `npx tsc --noEmit`.
