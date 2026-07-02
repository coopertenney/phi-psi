-- ============================================================================
-- Phi Kappa Psi — restore grants + link logins
-- Run this ONCE in the Supabase SQL editor, AFTER you have:
--   1. run schema.sql and seed.sql, and
--   2. created two auth users in Authentication → Users → Add user
--      (auto-confirm ON) with these exact emails:
--         mchen@stanford.edu      (President / admin  → exec view)
--         cnguyen@stanford.edu    (active member      → member view)
-- ============================================================================

-- ── Part 1: restore the role privileges that `drop schema public cascade` wiped.
-- Supabase normally grants these to the API roles automatically; the schema
-- reset removed them. Without this, PostgREST returns "permission denied"
-- (42501) for every table — even for a correctly logged-in user.
--
-- We grant to `authenticated` (logged-in) only, NOT `anon` (logged-out), so the
-- chapter's data stays private to people who have signed in. Row-Level Security
-- still decides WHICH ROWS each logged-in member can see.

grant usage on schema public to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Make future tables/sequences/functions inherit the same, so you never redo this.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
alter default privileges in schema public
  grant execute on functions to authenticated;

-- ── Part 2: link the two logins to their roster profiles (matched by email).
-- This sets profiles.auth_user_id so RLS (auth.uid()) recognizes who they are.
update profiles p
set auth_user_id = u.id
from auth.users u
where u.email = p.email
  and p.email in ('mchen@stanford.edu', 'cnguyen@stanford.edu');

-- Nudge PostgREST to pick up the new grants immediately.
notify pgrst, 'reload schema';

-- ── Verify: both rows should show a non-null auth_user_id and their role.
-- Expect: mchen → admin (President), cnguyen → member.
select p.email, (p.auth_user_id is not null) as linked, m.access_role, m.position
from profiles p
join memberships m on m.profile_id = p.id
where p.email in ('mchen@stanford.edu', 'cnguyen@stanford.edu')
order by m.access_role;
