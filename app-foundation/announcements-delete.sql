-- ============================================================================
-- Phi Kappa Psi — allow exec to DELETE announcements
-- Run ONCE in the Supabase SQL editor (or via the migration runner). schema.sql
-- + announcements-live.sql gave announcements a select policy (members, gated by
-- audience) and an insert policy (exec). There was no delete policy, so posts
-- could be created but never removed — the app now has an exec "Delete" control
-- that needs this. Same shape as events_cud: exec of the row's chapter only.
-- ============================================================================

begin;

drop policy if exists ann_delete on announcements;
create policy ann_delete on announcements for delete using (is_chapter_exec(chapter_id));

commit;

-- Verify: expect a row with cmd = DELETE.
select policyname, cmd from pg_policies where tablename = 'announcements' order by cmd;
