# Phi Psi Points & Attendance (standalone)

See `../phi-psi-points-app-spec.md` for scope/decisions.

## Setup

1. Create a new Supabase project (separate from the chapter app's).
2. Run `schema.sql` in the SQL editor.
3. Create exec logins by hand: Authentication → Users → Add user (email + password).
   There is no signup flow and no member accounts — any authenticated user is exec.
4. Copy `.env.local.example` to `.env.local` and fill in the project URL + anon key.
5. `npm install && npm run dev`.

## Routes

- `/login` — exec sign-in
- `/admin` — log points, add members, standings, recent activity
- `/admin/catalog` — point items, floor/ceiling, per-term cap + auto-award rules, start new term
- `/admin/attendance` — meetings, attendance grid, abroad/excused standing status
- `/board` — public, unlisted, read-only leaderboard + per-member breakdown (no login)

## Known tradeoff

`points_entries` is public-readable (the `/board` leaderboard has no login), so
anyone with the board link can query the table directly with the anon key and
see `logged_by` (exec email/name) even though the page itself never renders
it. Acceptable at this scope — noting it so it's a decision, not a surprise.

## Not built (unverified without a live project)

Everything above passes `next build` (typecheck), but there is no live Supabase
project wired up yet, so the actual DB round-trips and RLS policies haven't
been exercised end-to-end — do that after step 1-4 above, before relying on it.
