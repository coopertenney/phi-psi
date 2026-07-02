-- ============================================================================
-- Phi Kappa Psi — take ANNOUNCEMENTS fully live
-- Run ONCE in the Supabase SQL editor (or via the migration runner). The
-- announcements table + basic RLS already exist from schema.sql (any member
-- reads, exec writes) but two things the app needs are missing:
--   1. `audience` (all/officers) and `category` columns — the compose form and
--      feed cards use both; schema.sql only had title/body/pinned.
--   2. RLS never actually enforced the officers-only boundary — ann_read let
--      any chapter member select every row, relying on the UI to hide
--      officers-only posts. That's a real gap since the API is reachable
--      directly. This tightens it: members can no longer read officers-only
--      rows at the database level, not just in the UI.
-- ============================================================================

begin;

alter table announcements add column if not exists audience text not null default 'all'
  check (audience in ('all', 'officers'));
alter table announcements add column if not exists category text not null default 'general'
  check (category in ('general', 'event', 'finance', 'urgent'));

drop policy if exists ann_read  on announcements;
drop policy if exists ann_write on announcements;

create policy ann_read on announcements for select using (
  is_chapter_member(chapter_id) and (audience = 'all' or is_chapter_exec(chapter_id))
);
create policy ann_write on announcements for insert with check (is_chapter_exec(chapter_id));

commit;

-- Verify: 0 rows today (nothing posted yet in live mode).
select count(*) as announcements_now from announcements where chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001';
