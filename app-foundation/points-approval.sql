-- ============================================================================
-- Phi Kappa Psi — member self-logged points (submit for approval)
-- Run ONCE after points-live.sql. Idempotent — safe to re-run.
--
-- The points system is a port of the chapter's accountability tracker, so a
-- member can't self-AWARD points that count. Instead a member self-LOGS a
-- reward item as a REQUEST (status='pending'); an exec approves it at a glance
-- from the Points tab, and only then does it count toward totals/leaderboard.
--
--   1. adds points_entries.status ('pending' | 'approved'), default 'approved'
--      so every existing row and every exec-logged entry stays approved.
--   2. recreates member_standings to sum ONLY approved entries.
--   3. RLS: members may request (INSERT own pending row) + withdraw (DELETE own
--      pending row); exec still owns approve/reject via the existing _cud policy.
-- ============================================================================

begin;

-- 1. Status column. Default 'approved' is the safe migration: pre-existing rows
--    and future exec logs (which don't set status) remain counted; only member
--    self-requests are inserted as 'pending'.
do $$ begin
  create type point_entry_status as enum ('pending', 'approved');
exception when duplicate_object then null;
end $$;

alter table points_entries
  add column if not exists status point_entry_status not null default 'approved';

-- 2. Standings count approved only. security_invoker preserved (see schema.sql).
create or replace view member_standings
  with (security_invoker = on) as
select
  m.id              as membership_id,
  m.chapter_id,
  p.full_name,
  m.position,
  m.status,
  m.class_year,
  m.committee,
  coalesce(pts.total_points, 0)   as points,
  coalesce(att.attendance_pct, 0) as attendance_pct
from memberships m
join profiles p on p.id = m.profile_id
left join (
  select membership_id, sum(points) as total_points
  from points_entries where status = 'approved' group by membership_id
) pts on pts.membership_id = m.id
left join (
  select a.membership_id,
         round(100.0 * count(*) filter (where a.state = 'present') / nullif(count(*),0)) as attendance_pct
  from attendance a group by a.membership_id
) att on att.membership_id = m.id;

-- 3. RLS. The exec policy (points_entries_cud, "for all") already covers logging,
--    approving (UPDATE status->'approved'), and rejecting (DELETE). Add two
--    narrow member self-service policies on top of it:
--
--    a) Request: a member may INSERT a 'pending' row ONLY for their OWN
--       membership, ONLY for a reward, non-discretionary catalog item, and ONLY
--       at that item's catalog value — so a member can't inflate the ask or
--       self-log punishments/discretionary items.
drop policy if exists points_entries_self_request on points_entries;
create policy points_entries_self_request on points_entries for insert
  with check (
    status = 'pending'
    and membership_id in (
      select m.id from memberships m join profiles p on p.id = m.profile_id
      where p.auth_user_id = auth.uid()
    )
    and exists (
      select 1 from point_items pi
      where pi.id = points_entries.item_id
        and pi.kind = 'reward'
        and pi.discretionary = false
        and pi.points = points_entries.points
    )
  );

--    b) Withdraw: a member may DELETE their OWN still-pending request. Once an
--       exec approves it (status='approved'), it's locked to the member.
drop policy if exists points_entries_self_withdraw on points_entries;
create policy points_entries_self_withdraw on points_entries for delete
  using (
    status = 'pending'
    and membership_id in (
      select m.id from memberships m join profiles p on p.id = m.profile_id
      where p.auth_user_id = auth.uid()
    )
  );

commit;

-- Verify: status column exists, and pending entries (if any) are excluded from
-- standings totals.
-- (pe.status qualified: memberships also has a `status` column, so unqualified
--  `status` here is ambiguous.)
select count(*) filter (where pe.status = 'pending')  as pending_requests,
       count(*) filter (where pe.status = 'approved') as approved_entries
from points_entries pe join memberships m on m.id = pe.membership_id
where m.chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001';
