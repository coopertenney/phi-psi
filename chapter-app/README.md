# Phi Kappa Psi — Chapter App (Next.js)

The live app, scaffolded from the prototype + `../app-foundation` schema. The
**Members** screen is built end-to-end as the reference vertical; other screens
are placeholders to build next on the same data layer.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000  → redirects to /dashboard
```

It runs on **mock data** (the seed roster) out of the box — no backend needed.

## Connect Supabase (when ready)

1. Create the Supabase project, run `../app-foundation/schema.sql` then `seed.sql`.
2. `cp .env.local.example .env.local` and fill in the URL + anon key.

That's the only switch. `lib/data/index.ts` checks for the env vars: present →
queries Supabase (`member_standings`, `member_finances`, `chapter_stats`);
absent → mock. Components are identical either way.

## Layout

| Path | Role |
|------|------|
| `app/` | App Router pages — `members/` is the real one; rest are placeholders |
| `components/AppShell.tsx` | Sidebar + topbar (nav, role toggle, theme switcher) |
| `components/MembersScreen.tsx` | Members table + filters + detail drawer |
| `components/Providers.tsx` | Theme + role context (persisted to localStorage) |
| `lib/data/` | The data layer — `index.ts` (switch), `mock.ts`, Supabase queries |
| `lib/types.ts`, `lib/format.ts` | UI types + presentation helpers |
| `app/globals.css` | Design tokens (from `app-foundation/tokens.css`) + component CSS |

## Next verticals

Finances, Events, Attendance, Announcements — each is a page + a screen
component reading from `lib/data`, following the Members pattern. Wire Stripe
into Finances last.
