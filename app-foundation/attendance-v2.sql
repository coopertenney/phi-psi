-- ============================================================================
-- Phi Kappa Psi — attendance v2 (2026-07-05)
-- Run ONCE (idempotent). Adds:
--   1. Two more attendance states: 'late' and 'abroad' (was present/excused/absent).
--      The `state` column is converted enum -> text + CHECK so future states are a
--      one-line CHECK edit (no enum surgery) — same pattern events.type already uses.
--   2. member_term_statuses — a per-member, per-term standing status: 'abroad' all
--      quarter, or a recurring 'excused' with a free-text reason. Seeds the
--      take-attendance grid so exec doesn't re-mark the same brothers weekly.
--   3. Attendance % recomputed with the new states. Per Cooper's call:
--        %  = present / (present + absent)
--      i.e. 'late', 'excused', and 'abroad' are NEUTRAL — dropped from the
--      denominator (a brother abroad all term isn't penalized; late neither
--      helps nor hurts). Applied in BOTH derivation views so roster + stats agree.
-- ============================================================================

begin;

-- 0. Drop the two views that read attendance.state — Postgres won't alter a
--    column type while a view depends on it. Recreated (fresh) in step 3.
drop view if exists chapter_stats;
drop view if exists member_standings;

-- 1. attendance.state: enum -> text + CHECK (5 states, default 'absent').
alter table attendance alter column state drop default;
alter table attendance alter column state type text using state::text;
alter table attendance alter column state set default 'absent';
alter table attendance drop constraint if exists attendance_state_chk;
alter table attendance add constraint attendance_state_chk
  check (state in ('present', 'late', 'absent', 'excused', 'abroad'));

-- 2. member_term_statuses — all-quarter status (abroad / recurring excuse).
create table if not exists member_term_statuses (
  id            uuid primary key default gen_random_uuid(),
  chapter_id    uuid not null references chapters (id)    on delete cascade,
  membership_id uuid not null references memberships (id) on delete cascade,
  term_id       uuid not null references terms (id)       on delete cascade,
  kind          text not null check (kind in ('abroad', 'excused')),
  reason        text,                                    -- free text (esp. for 'excused')
  created_at    timestamptz not null default now(),
  created_by    uuid references memberships (id) on delete set null,
  unique (membership_id, term_id)                        -- one standing status per member per term
);
create index if not exists mts_chapter_term on member_term_statuses (chapter_id, term_id);

alter table member_term_statuses enable row level security;
drop policy if exists mts_read on member_term_statuses;
drop policy if exists mts_cud  on member_term_statuses;
-- Read: any chapter member (like attendance). Write: exec only.
create policy mts_read on member_term_statuses for select
  using (is_chapter_member(chapter_id));
create policy mts_cud on member_term_statuses for all
  using (is_chapter_exec(chapter_id))
  with check (is_chapter_exec(chapter_id));

grant select, insert, update, delete on member_term_statuses to authenticated;

-- 3a. member_standings — reproduced from profile-avatars.sql (keeps avatar_url +
--     approved-only points); ONLY the attendance_pct expression changes.
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
  coalesce(att.attendance_pct, 0) as attendance_pct,
  p.avatar_url
from memberships m
join profiles p on p.id = m.profile_id
left join (
  select membership_id, sum(points) as total_points
  from points_entries where status = 'approved' group by membership_id
) pts on pts.membership_id = m.id
left join (
  select a.membership_id,
         round(100.0 * count(*) filter (where a.state = 'present')
                     / nullif(count(*) filter (where a.state in ('present', 'absent')), 0)) as attendance_pct
  from attendance a group by a.membership_id
) att on att.membership_id = m.id;

-- 3b. chapter_stats — reproduced from schema.sql; ONLY the attendance subquery changes.
create or replace view chapter_stats as
select
  m.chapter_id,
  count(*) filter (where m.status <> 'inactive')               as active_members,
  count(*)                                                     as total_members,
  count(*) filter (where f.dues_state = 'paid')                as paid_count,
  count(*) filter (where f.dues_state = 'partial')             as partial_count,
  count(*) filter (where f.dues_state = 'due')                 as due_count,
  sum(f.paid_cents)                                            as collected_cents,
  sum(f.charged_cents)                                         as target_cents,
  round(avg(att.attendance_pct) filter (where m.status <> 'inactive')) as avg_attendance_pct
from memberships m
left join (
  select mm.id as membership_id,
         coalesce(dc.charged_cents,0) as charged_cents,
         coalesce(pay.paid_cents,0)   as paid_cents,
         case
           when coalesce(dc.charged_cents,0) = 0 then 'paid'
           when coalesce(pay.paid_cents,0) >= coalesce(dc.charged_cents,0) then 'paid'
           when coalesce(pay.paid_cents,0) > 0 then 'partial'
           else 'due'
         end as dues_state
  from memberships mm
  left join (select membership_id, sum(amount_cents) as charged_cents from dues_charges group by membership_id) dc on dc.membership_id = mm.id
  left join (select membership_id, sum(amount_cents) as paid_cents from payments where status='succeeded' group by membership_id) pay on pay.membership_id = mm.id
) f on f.membership_id = m.id
left join (
  select a.membership_id,
         round(100.0 * count(*) filter (where a.state='present')
                     / nullif(count(*) filter (where a.state in ('present','absent')),0)) as attendance_pct
  from attendance a group by a.membership_id
) att on att.membership_id = m.id
group by m.chapter_id;

commit;

-- Verify.
select 'states' as check, string_agg(distinct state, ', ') as detail from attendance
union all
select 'term_statuses', count(*)::text from member_term_statuses;
