-- ============================================================================
-- Phi Kappa Psi — grants safety-net for the newly-live tables
-- Run ONCE in the Supabase SQL editor, AFTER wire-everything-live.sql.
--
-- WHY: the earlier `drop schema public cascade` reset wiped Postgres's default
-- privileges. grants-and-link.sql restored them AND set `alter default
-- privileges ... to authenticated`, so tables created afterward in the SQL
-- editor SHOULD inherit the grant automatically. This file is belt-and-
-- suspenders: it re-grants explicitly so that even if the default-privileges
-- rule didn't apply (e.g. a table created by a different role), logged-in
-- members don't hit 42501 "permission denied". Idempotent — safe to re-run.
--
-- RLS still decides WHICH ROWS each member sees; these grants only open the
-- table to the `authenticated` role at all. anon (logged-out) stays locked.
-- ============================================================================

grant select, insert, update, delete on
  point_items, points_entries, pnms, pnm_ratings, pnm_votes, pnm_notes
  to authenticated;

-- announcements already existed; harmless to re-assert after the column adds.
grant select, insert, update, delete on announcements to authenticated;

-- Nudge PostgREST to pick up any schema/grant changes immediately.
notify pgrst, 'reload schema';

-- Verify: these tables should now list 'authenticated' with the DML privileges.
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee = 'authenticated'
  and table_name in ('point_items','points_entries','pnms','pnm_ratings','pnm_votes','pnm_notes','announcements')
group by table_name, grantee
order by table_name;
