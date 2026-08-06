# Roll Call App — Technical Spec (v1)

## Overview
A cross-platform roll call app (iOS + web) for taking attendance quickly and consistently. Core principle: **fast binary marking first, detail edits after.** People appear in a fixed order every time. Marking is a single tap: green = present, red = absent. Late arrivals, early departures, excused absences, and study-abroad exclusions are all handled as layers on top of that binary base — never something you have to think about mid-callout.

**Scale:** 1–3 admins, one shared roster, roster rarely changes after initial import. Always-online (no offline mode in v1).

---

## Stack

- **Mobile:** React Native + Expo (iOS)
- **Web:** Next.js
- **Shared logic:** `packages/shared` — TypeScript types, Supabase client, status/excusal calculation logic used by both apps
- **Backend:** Supabase (Postgres + Auth + Row Level Security + Storage for CSV imports if needed)
- **Auth:** Supabase Auth, email/password or magic link, for the 1–3 admin users only

### Repo structure (monorepo)
```
apps/
  mobile/       # Expo app
  web/          # Next.js app
packages/
  shared/       # types, supabase client, status logic, csv import logic
```

---

## Data Model (Supabase / Postgres)

### `rosters`
| column | type | notes |
|---|---|---|
| id | uuid, PK | |
| name | text | e.g. "Team A" |
| created_at | timestamptz | |

### `people`
| column | type | notes |
|---|---|---|
| id | uuid, PK | |
| roster_id | uuid, FK → rosters | |
| name | text | |
| sort_order | int | preserves fixed call order, set at CSV import |
| created_at | timestamptz | |

### `sessions`
One row per roll-call event (e.g. one per day/practice/class).
| column | type | notes |
|---|---|---|
| id | uuid, PK | |
| roster_id | uuid, FK → rosters | |
| date | date | |
| created_at | timestamptz | |

### `attendance`
One row per person per session.
| column | type | notes |
|---|---|---|
| id | uuid, PK | |
| session_id | uuid, FK → sessions | |
| person_id | uuid, FK → people | |
| status | enum('present','absent') | base binary mark |
| excused | boolean, default false | true if pre-filled via `excusal_rules` (kept even if rule later changes) |
| arrived_late | boolean, default false | set only in review/edit mode |
| left_early | boolean, default false | set only in review/edit mode |
| arrival_time | time, nullable | |
| departure_time | time, nullable | |
| updated_at | timestamptz | |

### `excusal_rules`
Recurring excused absences (e.g. "out every Tuesday").
| column | type | notes |
|---|---|---|
| id | uuid, PK | |
| person_id | uuid, FK → people | |
| day_of_week | int (0–6) | |
| reason | text, nullable | |
| start_date | date | |
| end_date | date, nullable | open-ended if null |

### `study_abroad_periods`
Full exclusion from roll call for a date range.
| column | type | notes |
|---|---|---|
| id | uuid, PK | |
| person_id | uuid, FK → people | |
| start_date | date | |
| end_date | date | |
| reason | text, nullable | |

**Row Level Security:** all tables scoped so only authenticated admins (1–3 users) tied to a roster can read/write it.

---

## Core Flow

### 1. CSV Import (one-time setup)
- Admin uploads CSV (name column, optionally an order column).
- Populates `people` with `sort_order` preserved from file order (or explicit order column if provided).
- Roster rarely changes after this — editing people happens via a simple settings screen, not re-import, going forward.

### 2. Starting a roll call
- Admin taps "New Roll Call" → creates a `sessions` row for today's date.
- Backend computes the initial list:
  1. **Study abroad check:** exclude any person whose `study_abroad_periods` range includes today. They don't appear on the list at all.
  2. **Excusal rule check:** for remaining people, if today's day-of-week matches an active `excusal_rules` entry, pre-create their `attendance` row with `status = 'absent'`, `excused = true`.
  3. Everyone else: `attendance` row created with `status` unset/null, ready to tap.

### 3. Taking roll call
- Fixed-order list, one row per person.
- Tap toggles: unmarked → green (present) → red (absent) → back to unmarked (or however you want the cycle — confirm during build).
- Pre-filled excused-absence rows show **red with an "excused" badge**, but remain tappable — if the person actually shows up, one tap flips to green (and `excused` should probably reset to false at that point — confirm during build).
- No late/early controls visible at this stage — keep it fast.

### 4. Review / Edit mode
- Unlocks once every person on the list has a status.
- Tap a **green** row → option to mark "Arrived late" (with time picker) → sets `arrived_late = true`, `arrival_time`.
- Tap a **green** row → option to mark "Left early" (with time picker) → sets `left_early = true`, `departure_time`.
- Visual treatment: green row + small clock badge (late) or arrow-out badge (left early) in the corner. Red rows have no modifiers.

### 5. Settings screen (admin config)
- Manage people (add/remove/reorder).
- Manage `excusal_rules` per person: day of week, reason, date range.
- Manage `study_abroad_periods` per person: date range, reason.

### 6. Reporting / Export (v1 scope)
- CSV export of attendance history (session date, person, status, excused, late, left early, times).
- Simple per-person attendance %: `present sessions / total eligible sessions` (sessions where they weren't study-abroad-excluded).

---

## v1 Scope Summary

**In scope:**
- CSV import (one-time)
- Fixed-order roll call, tap to toggle green/red
- Post-call review mode: late arrival / left early with timestamps
- Recurring excused-absence pre-fill (overridable)
- Study-abroad full exclusion from roll call
- Settings screen for managing excusal rules and study-abroad periods
- CSV export + per-person attendance %
- Cloud sync via Supabase (real-time across the 1–3 admins)

**Explicitly out of scope for v1:**
- Offline mode (always-online only; can be added later without schema changes)
- Push notifications
- Multi-org / multi-tenant support beyond the single roster + 1–3 admins

---

## Open items to confirm during build
- Exact tap-cycle behavior on the main roll call screen (unmarked → green → red → unmarked, or just green ⇄ red starting from red?)
- Whether flipping an excused-absence row to present should clear the `excused` flag or keep it as a historical note
- Whether `sessions` needs a label beyond date (e.g. "Morning practice" vs "Evening practice" if there can be more than one per day)
