-- ============================================================================
-- Phi Kappa Psi — appoint-exec RLS (2026-07-13)
-- Run ONCE (idempotent). Closes the TODO on the exec-handoff / succession
-- feature (CLAUDE.md "Appoint exec (succession)"): `app/members/actions.ts`
-- appointExec() already has an app-level admin guard, but the real safety net
-- is supposed to be a DB-level RLS policy restricting `memberships` UPDATE
-- (access_role/position) to a chapter admin. That function + policy were
-- added straight into schema.sql on 2026-07-05 (commit c011661) — AFTER this
-- chapter's DB was first seeded from schema.sql on 2026-06-30 — so unlike the
-- other `*-live.sql` migrations, it was never actually pushed to the live
-- database. This file is that missing incremental migration.
-- ============================================================================

begin;

-- Helper: is the current auth user an ADMIN (President) of this chapter?
-- Admin is the top tier — it can appoint the exec board (change
-- access_role/position on memberships).
create or replace function is_chapter_admin(p_chapter uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from memberships m
    join profiles p on p.id = m.profile_id
    where m.chapter_id = p_chapter
      and p.auth_user_id = auth.uid()
      and m.access_role = 'admin'
  );
$$;

-- APPOINTMENTS: only an admin (President) may change roles/positions on the
-- roster — appointing the exec board and demoting outgoing officers (see
-- app/members/actions.ts → appointExec). USING checks the actor is admin;
-- WITH CHECK re-checks after the row is written.
drop policy if exists roster_admin_update on memberships;
create policy roster_admin_update on memberships
  for update using (is_chapter_admin(chapter_id))
  with check (is_chapter_admin(chapter_id));

commit;

-- Verify (expect one row: roster_admin_update / UPDATE):
--   select policyname, cmd from pg_policies where tablename = 'memberships';
