# Phi Kappa Psi — Standalone Points & Attendance App
## Spec v1 (pre-build)

## 1. What this is

A standalone iOS-installable web app (PWA) that pulls the Points & Attendance
system out of the existing Phi Psi chapter app and ships it as its own
product, with its own backend. It replaces nothing today — the chapter app's
`/points` tab keeps running unchanged; this is a new, separate app that
happens to implement the same scoring logic.

## 2. Decisions already made

**Scope** — Points & Attendance only. No members roster/dues/finances/
recruitment/announcements/socials. A minimal list of people still has to
exist since points attach to someone, but nothing else from the chapter
app's data model comes along.

**Tenancy** — Single chapter (Phi Psi, Cal Beta). Not building this as a
multi-org product; no per-chapter signup flow, no org-scoped config beyond
what one chapter needs.

**Platform** — Installable web app (PWA), same approach as the existing
chapter app already uses (add-to-homescreen, `manifest.json` + a push-only
service worker with no offline caching). One Next.js codebase serves both
the web and the "iOS app" experience. Not React Native, not native Swift.

**Backend** — A brand-new Supabase project, separate from the chapter app's.
No shared tables, no shared RLS.

**Historical data** — Starts fresh. No import of the chapter app's existing
`points_entries`/attendance history. The ledger begins at zero on launch day.

**Auth / login model** — Exec-only login. One or a few admin accounts
authenticate to log points, manage the catalog, and record attendance.
Members do not get accounts — they see a read-only link (leaderboard +
their own point breakdown), no sign-in required.

**Relationship to the existing chapter app** — Runs in parallel,
indefinitely, for now. The chapter app's `/points` tab is untouched. The two
ledgers are independent and can drift if the same event gets logged in only
one place — accepted for now, revisit later if that becomes a real problem.

## 3. Defaults I'm assuming unless told otherwise

These are smaller calls that don't change the architecture much either way,
so I'm defaulting rather than blocking on them. Flag any of these if you
want something different:

- **Term/reset concept** — carry over the idea of a floor/ceiling and an
  optional per-term reset (the chapter app's `points_floor` /
  `points_ceiling` / `points_reset_each_term`), rather than a plain running
  total with a manual reset button.
- **Attendance capture** — stays exec-recorded (a meeting + a grid of who
  showed up), same as today, not a self-check-in flow.
- **Auto-award from attendance** — keep the rule where a catalog item
  flagged `auto_trigger` gets awarded automatically when attendance is
  recorded, and is hidden from the manual "log points" picker so it can't be
  double-counted.
- **Look/branding** — one theme, not the chapter app's three
  (cardinal/hunter/heritage) — this is a smaller, single-purpose tool.
- **Catalog editing** — keep it admin-editable in-app (add/edit/archive
  point items, reorder, flip reward↔punishment), not a fixed hardcoded list.

## 4. Resulting shape (subject to the files below confirming the logic)

**Data model** (new Supabase project):
- `members` — name, optional photo. No `auth_user_id`, no login.
- `point_items` — label, value, reward/punishment flag, active/archived,
  `auto_trigger`, `max_per_term` (if terms are kept).
- `points_log` — member, item, date, logged-by, term (if kept).
- `meetings` / `attendance` — meeting date/label, per-member present/absent,
  feeding `auto_trigger` items into `points_log`.
- `settings` — floor, ceiling, reset-each-term toggle (if kept).

**Auth**: one gate (exec/admin login) in front of all write actions.
Leaderboard + individual point breakdowns are reachable via a public or
unlisted read-only link, no login.

**Scoring engine**: port the clamp/floor/ceiling math and auto-trigger rule
from the chapter app's `lib/points.ts`, not reinvent it — hence the file
request below.

## 5. Missing — need before I can actually scope/build

I only have `DEPLOY.md`, `README.md`, and `CLAUDE.md` from the chapter app
right now — descriptions of the system, not the code. To build the
standalone engine so it matches what the chapter actually expects (rather
than a slightly-different reimplementation from memory of the docs), I need:

- [ ] **`lib/points.ts`** — the actual clamp/floor/ceiling scoring logic,
  the `auto_trigger` rule, `max_per_term` enforcement. This is the one file
  I most need — everything else is negotiable, this isn't.
- [ ] **`lib/engagement.ts`** — the attendance-side logic that
  `recordAttendance` uses, since that's what fires `auto_trigger` items.
- [ ] **`lib/calendar.ts`** — `BASE_TERM` / `advanceTerm`, only needed if
  we're keeping the term-reset concept (see defaults above — flag if you'd
  rather drop terms entirely and skip this file).
- [ ] **`app/points/actions.ts`** — `createPointItem` / `updatePointItem` /
  `archivePointItem` / `reorderPointItems`, `logPoints` / `requestPoints`,
  so the standalone app's write paths match the validation/guard rules
  already worked out here.
- [ ] **Points/attendance UI components** — whatever renders the
  leaderboard, the "Point values" admin drawer, and the attendance grid
  (component names weren't listed individually in the docs I have — just
  send whatever exists under `components/` for these screens). Reference
  only, for look/interaction — not expected to port as-is given the new
  no-member-login model.
- [ ] **`app-foundation/points-catalog-crud.sql`** and
  **`points-rules-auto.sql`** — the existing column/table shapes for the
  catalog and engine rules, so the new project's schema isn't guessing at
  column names or types.
- [ ] **`lib/types.ts`** (or just the points/attendance-relevant types) —
  for the shapes for `MemberRow`-equivalent, point item, log entry.

Not needed given the decisions above (skip sending these): anything
members/dues/finances/recruitment/announcements/socials-related, the
Supabase schema/RLS for the shared project, auth/profile code, and the
three-theme CSS tokens.

## 6. Next step

Once the files above are in hand, I'll confirm the scoring logic matches
this spec, write up the new Supabase schema + the Next.js app structure,
and start building. Will flag anything in the files that contradicts an
assumption made here (e.g., if `max_per_term` behaves differently than
described) before proceeding rather than silently reconciling it.
