# Chapter Dashboard — app foundation

This folder is the **bridge from the static prototype to a live app**. It commits
you to nothing premature (no framework chosen yet) but locks in the decisions
that are expensive to retrofit later.

| File | What it is |
|------|------------|
| `schema.sql` | Postgres / Supabase schema — tables, derived views, and Row-Level Security |
| `seed.sql` | Test data (the prototype's roster) — run after `schema.sql` to make the views return realistic numbers |
| `types.ts` | TypeScript types mirroring the schema (row types + UI view-models) |
| `tokens.css` | Design tokens (colors, fonts, shadows, the 3 themes), extracted verbatim from the prototype |
| `../phi-kappa-psi-dashboard.html` | The approved visual design + interaction reference |

## How the prototype maps to the schema

| Prototype mock data | Becomes |
|---------------------|---------|
| `MEMBERS[]` | `profiles` + `memberships` (rows) → `member_standings` (view) |
| `m.points`, `m.attendance` | **derived** from `points_entries` and `attendance` |
| `m.dues` / balance | **derived** from `dues_charges` − succeeded `payments` |
| `EVENTS[]` + `rsvp/capacity` | `events` + `rsvps` |
| `ANNOUNCEMENTS[]` + reactions/comments | `announcements` + reaction/comment tables |
| `stats` (the 4 cards) | `chapter_stats` (view) |
| `role: exec \| member` toggle | `memberships.access_role` + RLS (real, server-enforced) |

## The decisions baked in (and why)

1. **Multi-tenant** — every row carries `chapter_id`. One chapter today; adding
   more later is free instead of a rewrite.
2. **Roles in the DB, split two ways** — `access_role` (what you can see/do) vs.
   `position` (your title). The prototype conflated them.
3. **Store raw facts, derive the numbers** — payments/points/attendance are
   stored; percentages and balances come from SQL views. Never store a total
   you can recompute.
4. **Authorization is enforced in Postgres (RLS), not the UI.** In the prototype,
   a member simply isn't *shown* others' balances. In the live app they
   physically cannot query them — see the `dues_read` / `payments_read` policies.
5. **No card data, ever** — `payments` stores a Stripe payment-intent id + status.

## Suggested next steps

1. **Create a Supabase project** (this is the one step only you can do — it needs
   your account). Grab the project URL + anon key for the app later.
2. **Run `schema.sql`** in the SQL editor, then **run `seed.sql`**.
3. **Verify** with `select * from chapter_stats;` — you should see 11 active / 12
   total members, 6/3/3 paid/partial/due, and 65% dues collected. If those match,
   the schema + derived views are sound.
4. **Generate types from the live DB** (`supabase gen types typescript`) and
   reconcile against `types.ts` — they should line up.
5. **Scaffold the app** (recommended: Next.js + TypeScript), import `tokens.css`
   globally, and rebuild **one vertical end-to-end** — Members is the best first
   slice: list → detail drawer → real `member_standings` data.
6. Add screens one at a time; **wire Stripe for dues last**.
7. **Finish the RLS pass** — `schema.sql` covers the sensitive tables; events,
   rsvps, meetings, and points still need policies (same read=member /
   write=exec pattern, with RSVPs writable by the member themselves).

### Linking a real login (to test RLS)

The seed leaves `profiles.auth_user_id` null (those are tracked people, not
logins yet). To test the exec/member boundary for real: create a Supabase auth
user (Authentication → Users), then link it to a seeded profile —
e.g. as a plain member to confirm the finance boundary:

```sql
update profiles set auth_user_id = '<the auth user uuid>'
where email = 'cnguyen@stanford.edu';   -- Caleb is a 'member', not exec
```

Then run the member-view sanity check below.

## Sanity checks before you trust it

- **Test the VIEW, not just the table.** Postgres views bypass base-table RLS
  unless created `with (security_invoker = on)` — which both `member_standings`
  and `member_finances` are. Log in as a non-exec **member** and
  `select * from member_finances` — you must get back **only your own row**. If
  other members' `balance_cents` appear, `security_invoker` isn't taking effect
  and you have a data leak. (Querying the `payments` table is not enough — the
  app reads the view.)
- Confirm `member_finances.dues_state` matches what you'd compute by hand for a
  partial payer.
- Confirm `chapter_stats.avg_attendance_pct` excludes inactive members (it does —
  mirrors the prototype). `chapter_stats` runs as definer on purpose: it exposes
  only chapter totals (no per-member rows), so scope who can read it at the app
  layer.
