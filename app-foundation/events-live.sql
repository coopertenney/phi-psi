-- ============================================================================
-- Phi Kappa Psi — take EVENTS live
-- Run ONCE in the Supabase SQL editor, after the roster is loaded.
--   1. brings the events table up to what the app shows (description, end time)
--   2. clears the 4 dummy seed events (+ their meetings/attendance/rsvps)
--   3. turns on Row-Level Security for events/rsvps/meetings/attendance
-- After this, events you create in the app persist here, and RLS enforces:
--   read = any chapter member · create/edit/delete = exec · RSVP = your own only.
-- ============================================================================

begin;

-- 1. Schema: the app's event form has a description and an end time; add them.
--    Relax `type` from the old enum to plain text so the app's richer type set
--    (meeting/brotherhood/etc.) stores without enum surgery.
alter table events add column if not exists description text;
alter table events add column if not exists ends_at timestamptz;
alter table events alter column type drop default;
alter table events alter column type type text using type::text;
alter table events alter column type set default 'social';

-- 2. Clear the dummy seed events. rsvps cascade on event; attendance cascades on
--    meeting; points_entries.event_id is set-null (entries kept, link cleared).
delete from events   where chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from meetings where chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- 3. Row-Level Security.
alter table events     enable row level security;
alter table rsvps      enable row level security;
alter table meetings   enable row level security;
alter table attendance enable row level security;

-- Helper: the membership ids belonging to the current login.
-- (inline as a subquery in the policies below)

-- EVENTS — read: any member · write: exec.
drop policy if exists events_read   on events;
drop policy if exists events_cud     on events;
create policy events_read on events for select using (is_chapter_member(chapter_id));
create policy events_cud  on events for all
  using (is_chapter_exec(chapter_id)) with check (is_chapter_exec(chapter_id));

-- RSVPS — read: any member of the event's chapter · write: only your own row.
drop policy if exists rsvps_read on rsvps;
drop policy if exists rsvps_mine on rsvps;
create policy rsvps_read on rsvps for select using (
  exists (select 1 from events e where e.id = rsvps.event_id and is_chapter_member(e.chapter_id))
);
create policy rsvps_mine on rsvps for all
  using (membership_id in (
    select m.id from memberships m join profiles p on p.id = m.profile_id
    where p.auth_user_id = auth.uid()))
  with check (membership_id in (
    select m.id from memberships m join profiles p on p.id = m.profile_id
    where p.auth_user_id = auth.uid()));

-- MEETINGS / ATTENDANCE — read: member · write: exec. (For the attendance vertical.)
drop policy if exists meetings_read on meetings;
drop policy if exists meetings_cud  on meetings;
create policy meetings_read on meetings for select using (is_chapter_member(chapter_id));
create policy meetings_cud  on meetings for all
  using (is_chapter_exec(chapter_id)) with check (is_chapter_exec(chapter_id));

drop policy if exists attendance_read on attendance;
drop policy if exists attendance_cud  on attendance;
create policy attendance_read on attendance for select using (
  exists (select 1 from meetings mt where mt.id = attendance.meeting_id and is_chapter_member(mt.chapter_id)));
create policy attendance_cud on attendance for all
  using (exists (select 1 from meetings mt where mt.id = attendance.meeting_id and is_chapter_exec(mt.chapter_id)))
  with check (exists (select 1 from meetings mt where mt.id = attendance.meeting_id and is_chapter_exec(mt.chapter_id)));

commit;

-- Verify: should be 0 events now (clean slate).
select count(*) as events_now from events where chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001';
