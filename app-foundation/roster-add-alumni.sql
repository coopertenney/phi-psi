-- ============================================================================
-- Phi Kappa Psi — add 15 missing brothers to the roster + fix 2 truncated names
-- Run ONCE in the Supabase SQL editor, THEN re-run lineage-live.sql (see note).
--
-- Why: load-roster.sql loaded only the 90 "Spring 2026 actives" from the CSV.
-- The lineage tree references 15 more brothers as bigs. 14 are Graduating Seniors
-- (class 2026 — Kyle Schmoyer, Alexander Daix, Arjin Claire, …) → added as ALUMNI;
-- 1 (Jason Zhang) is an Active Junior dropped from the CSV by mistake → added as
-- ACTIVE. Because none were member rows, they showed in the Lineage tab as faded
-- name-only anchors, and their own big–little links never loaded (lineage-live.sql
-- keys littles by email, so their rows silently no-op).
--
-- This file is ADDITIVE and idempotent — no delete/cascade, unlike load-roster.sql:
--   1. Fixes two truncated profile names already in the DB.
--   2. Inserts the 14 alumni as status 'inactive' (lineage-only — excluded from
--      the members list + all stat cards; see getMembers/getLineageRoster and the
--      chapter_stats change below) and Jason Zhang as status 'active'.
--   3. Rewrites chapter_stats so alumni never inflate any user-facing stat.
--
-- ⚠️  AFTER running this, RE-RUN app-foundation/lineage-live.sql. It clears and
--     reloads the lineage table, this time resolving these 15 to real membership
--     ids — so Arjin links to Anthony Chen, the others connect to their bigs,
--     and every "big of a current member" up-link points at a real node.
-- ============================================================================

begin;

-- 1. Fix two truncated profile names (live DB stored short forms). -------------
update profiles set full_name = 'Carlos Valencia Garcia' where email = 'carlov@stanford.edu';
update profiles set full_name = 'Saul Hernandez Vigil'   where email = 'saulh22@stanford.edu';

-- 2. Stage the 15 brothers missing from load-roster.sql. 14 are Graduating
--    Seniors (class 2026) per the authoritative chapter roster → 'inactive'
--    (alumni, lineage-only). Jason Zhang is an Active Junior (2027) who was
--    dropped from the Spring-2026 actives CSV by mistake → 'active' (real member).
create temp table add_roster (full_name text, email text, class_year int, status member_status) on commit drop;
insert into add_roster (full_name, email, class_year, status) values
  ('Arjin Claire',        'aclaire@stanford.edu',  2026, 'inactive'),
  ('Kyle Schmoyer',       'kyles7@stanford.edu',   2026, 'inactive'),
  ('Alexander Daix',      'asdaix@stanford.edu',   2026, 'inactive'),
  ('Alexander Belfiore',  'abelfior@stanford.edu', 2026, 'inactive'),
  ('Michael Hemker',      'mjhemker@stanford.edu', 2026, 'inactive'),
  ('Sam Shors',           'samshors@stanford.edu', 2026, 'inactive'),
  ('Graham Johnstone',    'grahamjo@stanford.edu', 2026, 'inactive'),
  ('James Ubi',           'jamesu72@stanford.edu', 2026, 'inactive'),
  ('Dean Cureton',        'dcureton@stanford.edu', 2026, 'inactive'),
  ('Blake Pigott',        'bpigott@stanford.edu',  2026, 'inactive'),
  ('Aaron Lee',           'aaroncl@stanford.edu',  2026, 'inactive'),
  ('Mercer Weis',         'mweis2@stanford.edu',   2026, 'inactive'),
  ('Patrick Walsh',       'walshp26@stanford.edu', 2026, 'inactive'),
  ('Jonathan Morales',    'jonath4n@stanford.edu', 2026, 'inactive'),
  ('Jason Zhang',         'jasonbz@stanford.edu',  2027, 'active');

-- 3. Profiles then memberships — idempotent (safe to re-run). ------------------
insert into profiles (full_name, email)
  select full_name, email from add_roster
  on conflict (email) do nothing;

insert into memberships (chapter_id, profile_id, access_role, position, status, class_year, committee)
  select 'aaaaaaaa-0000-0000-0000-000000000001', p.id, 'member'::access_role, null, r.status, r.class_year, null
  from add_roster r
  join profiles p on p.email = r.email
  where not exists (
    select 1 from memberships m
     where m.profile_id = p.id
       and m.chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  );

-- 4. Keep alumni out of the chapter-wide stat cards. The original chapter_stats
--    counted total_members / dues splits over ALL memberships; now that alumni
--    exist as 'inactive' rows, every count/sum must filter them out so the
--    Dashboard/Finances numbers stay about the active chapter only. Body matches
--    the authoritative attendance-v2.sql definition (present/absent denominator),
--    NOT schema.sql — only the count/sum filters change here.
create or replace view chapter_stats as
select
  m.chapter_id,
  count(*) filter (where m.status <> 'inactive')               as active_members,
  count(*) filter (where m.status <> 'inactive')               as total_members,
  count(*) filter (where m.status <> 'inactive' and f.dues_state = 'paid')    as paid_count,
  count(*) filter (where m.status <> 'inactive' and f.dues_state = 'partial') as partial_count,
  count(*) filter (where m.status <> 'inactive' and f.dues_state = 'due')     as due_count,
  sum(f.paid_cents)   filter (where m.status <> 'inactive')    as collected_cents,
  sum(f.charged_cents) filter (where m.status <> 'inactive')   as target_cents,
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

-- 5. Verify — expect 105 memberships after this + a lineage-live.sql re-run.
select count(*) as total_members from memberships
  where chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001';         -- 105
select status, count(*) from memberships
  where chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  group by status order by status;                                    -- active 91 / inactive 14
select full_name, big_name, little_names from member_standings
  where full_name in ('Arjin Claire', 'Aaron Tiao', 'Shawn Gregory', 'Kyle Schmoyer')
  order by full_name;
