# Roll Call App

Implementation of `rollcall-app-spec.md` (v1). Monorepo: `apps/web` (Next.js, full feature set),
`apps/mobile` (Expo, core roll-call flow only — **unverified**, no simulator was used to test it),
`packages/shared` (types + Supabase client + status/excusal/tap-cycle logic used by both).

## 1. Create the Supabase project

1. Create a new project at supabase.com.
2. In the SQL editor, run `supabase/migrations/0001_init.sql` (creates all tables, RLS policies).
3. In Auth → Users, manually create 1–3 admin accounts (email/password). There is no public signup
   in v1 — admin accounts are provisioned by hand, matching the spec's "1–3 admins" scale.
4. Grab your project URL and anon key from Project Settings → API.

## 2. Configure environment variables

Web (`apps/web/.env.local`):
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

Mobile (`apps/mobile/.env`):
```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

(`.env.example` files are provided in both app directories.)

## 3. Install and run

```
npm install                          # from repo root, installs all workspaces
npm run dev:web                      # Next.js app at localhost:3000
npm run dev:mobile                   # Expo dev server (needs a simulator or Expo Go device)
```

First login redirects to `/login` (web) or the login screen (mobile). Sign in with an admin
account created in step 1. On first successful login the app auto-creates the single shared
roster row — there's no roster-picker UI since v1 is single-roster only, per spec.

Then: **Settings → Import roster CSV** (web only) to load people, then **New Roll Call**.

## What's built (maps to spec's v1 scope)

- CSV import (paste-in, `name`/`order` columns)
- Fixed-order roll call, tap-to-cycle marking
- Post-call review mode: late arrival / left early with timestamps (web has a time picker;
  mobile uses a simplified tap-cycle — see Mobile section below)
- Recurring excused-absence pre-fill, overridable by a single tap
- Study-abroad full exclusion from the roll call list
- Settings screen: manage people (add/remove/reorder), excusal rules, study-abroad periods
- CSV export of attendance history + per-person attendance %
- Supabase Auth (email/password), RLS scoped to authenticated users

## Decisions made building this (spec's "open items to confirm")

- **Tap cycle:** `unmarked → present → absent → unmarked`. A pre-filled excused-absent row is a
  special case — one tap flips it straight to present (person showed up after all).
- **Excused flag on override:** clears (`excused → false`) once a pre-filled excused-absent row is
  tapped to present. No historical trace is kept of the original rule match.
- **Session label:** added an optional nullable `label` column on `sessions` (unused by the UI
  beyond display) so multiple same-day sessions can be told apart later without a migration.

## Mobile scope note

The Expo app was never run in a simulator (none available while building), but `npx expo export -p
ios` was run from `apps/mobile` to confirm Metro actually bundles it — this exercises the
monorepo `metro.config.js` and the `@rollcall/shared` workspace import end to end, which `tsc`
alone can't verify. It covers login + the core tap-to-mark flow + review mode, using a simplified
inline cycle (late → left early → clear) instead of a native time picker, to avoid pulling in a
native date-picker dependency sight-unseen. Settings and Reports were intentionally left web-only
for v1 — admin config work is a poor fit for a phone screen anyway. Treat the mobile app as a
solid starting point to run on a device and iterate on, not a finished feature-parity build.

## Not built (explicitly out of scope per spec)

- Offline mode
- Push notifications
- Multi-org / multi-tenant support
