-- ============================================================================
-- Phi Kappa Psi — wire ANNOUNCEMENTS + POINTS + RECRUITMENT live, in one go
-- Run ONCE in the Supabase SQL editor, after the roster is loaded. This is
-- announcements-live.sql + points-live.sql + recruitment-live.sql concatenated
-- in dependency order (each file still exists standalone in this folder if you
-- ever need to re-read or re-run just one piece).
-- ============================================================================


-- ============================================================================
-- PART 1 — ANNOUNCEMENTS
-- The announcements table + basic RLS already exist from schema.sql (any
-- member reads, exec writes) but two things the app needs are missing:
--   1. `audience` (all/officers) and `category` columns — the compose form and
--      feed cards use both; schema.sql only had title/body/pinned.
--   2. RLS never actually enforced the officers-only boundary — ann_read let
--      any chapter member select every row, relying on the UI to hide
--      officers-only posts. This tightens it: members can no longer read
--      officers-only rows at the database level, not just in the UI.
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


-- ============================================================================
-- PART 2 — POINTS
--   1. adds the point_items catalog table (the sheet's "POINTS (items)" tab)
--   2. wires points_entries to the catalog (item_id) + an approver name
--   3. seeds the real 39-item catalog from the chapter's accountability tracker
--   4. turns on Row-Level Security: read = any chapter member, write = exec
--   5. closes a race: two execs checking in to the same event at once could
--      otherwise create two `meetings` rows for it (meetings.event_id had no
--      uniqueness). One partial unique index fixes both events and points'
--      shared meetings table.
-- Core points engine only (MAX(-5, sum) + leaderboard) — the sheet's
-- attendance/dues/sigs penalty fast-follow is intentionally deferred, see
-- TODO(fast-follow) in lib/points.ts.
-- ============================================================================

begin;

-- 0. Hardening carried along from events-live.sql: prevent duplicate meetings
--    for the same event under concurrent check-in writes.
create unique index if not exists meetings_event_id_unique on meetings (event_id) where event_id is not null;

-- 1. Catalog table.
create type point_kind as enum ('reward', 'punishment');

create table if not exists point_items (
  id            uuid primary key default gen_random_uuid(),
  chapter_id    uuid not null references chapters (id) on delete cascade,
  label         text not null,
  points        integer not null default 0,   -- 0 for discretionary; exec sets per entry
  kind          point_kind not null,
  discretionary boolean not null default false,
  sort_order    integer not null default 0
);
create index if not exists point_items_chapter_idx on point_items (chapter_id, sort_order);

-- 2. Wire the existing ledger to the catalog + an approver name (typed by the
--    exec logging the entry, same as the sheet — not necessarily a login).
alter table points_entries add column if not exists item_id uuid references point_items (id) on delete set null;
alter table points_entries add column if not exists approved_by text;

-- 3. Seed the real catalog for this chapter (only if empty — safe to re-run).
do $$
declare
  v_chapter uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
begin
  if exists (select 1 from point_items where chapter_id = v_chapter) then
    raise notice 'point_items already seeded for chapter %, skipping', v_chapter;
    return;
  end if;

  insert into point_items (chapter_id, label, points, kind, discretionary, sort_order) values
  -- Rewards (sort_order 1..20)
  (v_chapter, 'Being GP or VP (per quarter)', 30, 'reward', false, 1),
  (v_chapter, 'Former president', 30, 'reward', false, 2),
  (v_chapter, 'Be a senior who is bought into the org', 20, 'reward', false, 3),
  (v_chapter, 'Being Part of Exec (per quarter) and completing deliverables', 20, 'reward', false, 4),
  (v_chapter, 'Painting a (beautiful) Die Table', 15, 'reward', false, 5),
  (v_chapter, 'Being Part of a Committee (per quarter) and complete deliverables', 10, 'reward', false, 6),
  (v_chapter, 'Be a rush chair and complete deliverables', 8, 'reward', false, 7),
  (v_chapter, 'Extra Sober Shift (above minimum)', 6, 'reward', false, 8),
  (v_chapter, 'Volunteering to Pick Up Someone''s Sober Shift', 5, 'reward', false, 9),
  (v_chapter, 'Fronting a large purchase for the house', 5, 'reward', false, 10),
  (v_chapter, 'Attend a Philanthropy Event', 4, 'reward', false, 11),
  (v_chapter, 'DJing', 4, 'reward', false, 12),
  (v_chapter, 'Party Setup Shift', 3, 'reward', false, 13),
  (v_chapter, 'Narcan Training (one time only)', 3, 'reward', false, 14),
  (v_chapter, 'Completing a (required) Sober Shift', 3, 'reward', false, 15),
  (v_chapter, 'Party Cleanup Crew Shift', 3, 'reward', false, 16),
  (v_chapter, 'Picked Up an Extra Hash Shift', 2, 'reward', false, 17),
  (v_chapter, 'Bringing a (unique) PNM to the house', 2, 'reward', false, 18),
  (v_chapter, 'Showing Up to Formal Chapter Wearing Formal Attire', 1, 'reward', false, 19),
  (v_chapter, 'Completing a (required) Party Shift', 1, 'reward', false, 20),
  -- Discretionary (exec sets value per entry; sort_order 21..24)
  (v_chapter, 'Other task approved in advance by GP or VP', 0, 'reward', true, 21),
  (v_chapter, 'Planning a Successful Event (e.g. CoPhi house, mixer)', 0, 'reward', true, 22),
  (v_chapter, 'Big/Little Transfer', 0, 'reward', true, 23),
  (v_chapter, 'Make an acquisition for the house', 0, 'reward', true, 24),
  -- Punishments (sort_order 25..39)
  (v_chapter, 'Late to an Exec meeting (unexcused)', -1, 'punishment', false, 25),
  (v_chapter, 'Outstanding Fines', -2, 'punishment', false, 26),
  (v_chapter, 'Missing Chapter', -2, 'punishment', false, 27),
  (v_chapter, 'Late Dues', -2, 'punishment', false, 28),
  (v_chapter, 'Skipping a committee meeting (unexcused)', -3, 'punishment', false, 29),
  (v_chapter, 'Missing Hash Shift', -3, 'punishment', false, 30),
  (v_chapter, 'Skipping Minor PKP Responsibility', -3, 'punishment', false, 31),
  (v_chapter, 'Skipping an Exec meeting (unexcused)', -3, 'punishment', false, 32),
  (v_chapter, 'Skipping a Rush Event', -4, 'punishment', false, 33),
  (v_chapter, 'Missing a party shift', -5, 'punishment', false, 34),
  (v_chapter, 'Skipping Major PKP Responsibility', -8, 'punishment', false, 35),
  (v_chapter, 'Unpaid Dues Outstanding (temporary until paid)', -8, 'punishment', false, 36),
  (v_chapter, 'Missing a Sober Shift', -15, 'punishment', false, 37),
  (v_chapter, 'Drinking as a Sober Monitor', -15, 'punishment', false, 38),
  (v_chapter, 'Breaking Phi Psi rules/conduct', -15, 'punishment', false, 39);
end $$;

-- 4. Row-Level Security. Read = any chapter member (the leaderboard needs to
--    see everyone's totals). Write = exec only (Log points is an exec action).
alter table point_items    enable row level security;
alter table points_entries enable row level security;

drop policy if exists point_items_read on point_items;
drop policy if exists point_items_cud  on point_items;
create policy point_items_read on point_items for select using (is_chapter_member(chapter_id));
create policy point_items_cud  on point_items for all
  using (is_chapter_exec(chapter_id)) with check (is_chapter_exec(chapter_id));

drop policy if exists points_entries_read on points_entries;
drop policy if exists points_entries_cud  on points_entries;
create policy points_entries_read on points_entries for select using (
  exists (select 1 from memberships m where m.id = points_entries.membership_id and is_chapter_member(m.chapter_id))
);
create policy points_entries_cud on points_entries for all
  using (exists (select 1 from memberships m where m.id = points_entries.membership_id and is_chapter_exec(m.chapter_id)))
  with check (exists (select 1 from memberships m where m.id = points_entries.membership_id and is_chapter_exec(m.chapter_id)));

commit;


-- ============================================================================
-- PART 3 — RECRUITMENT / RUSH CRM
-- Creates the 4 tables the Recruitment module needs (none exist yet — this
-- vertical has been mock-only since it was built):
--   pnms         — PNM profiles + pipeline stage (exec-owned)
--   pnm_ratings  — 1 row per brother per PNM, 1-5 stars (self-writable)
--   pnm_votes    — 1 row per brother per PNM, yes/no (self-writable)
--   pnm_notes    — free-text note thread (any brother can add)
-- rating/vote counts + averages shown in the app are DERIVED from ratings/votes
-- at read time, never stored — same "raw facts, derived numbers" rule as the
-- rest of the schema.
-- ============================================================================

begin;

create type pnm_stage as enum
  ('prospect', 'invited', 'interview', 'voting', 'bid', 'accepted', 'declined');

create table pnms (
  id               uuid primary key default gen_random_uuid(),
  chapter_id       uuid not null references chapters (id) on delete cascade,
  full_name        text not null,
  standing         text,                        -- "Freshman"/"Sophomore"/...
  major            text,
  email            text,
  phone            text,
  referred_by      text,                         -- brother's name, free text (not a membership FK)
  stage            pnm_stage not null default 'prospect',
  events_attended  integer not null default 0,
  created_at       timestamptz not null default now()
);
create index on pnms (chapter_id, stage);

create table pnm_ratings (
  id            uuid primary key default gen_random_uuid(),
  pnm_id        uuid not null references pnms (id) on delete cascade,
  membership_id uuid not null references memberships (id) on delete cascade,
  rating        smallint not null check (rating between 1 and 5),
  created_at    timestamptz not null default now(),
  unique (pnm_id, membership_id)
);

create table pnm_votes (
  id            uuid primary key default gen_random_uuid(),
  pnm_id        uuid not null references pnms (id) on delete cascade,
  membership_id uuid not null references memberships (id) on delete cascade,
  vote          text not null check (vote in ('yes', 'no')),
  created_at    timestamptz not null default now(),
  unique (pnm_id, membership_id)
);

create table pnm_notes (
  id            uuid primary key default gen_random_uuid(),
  pnm_id        uuid not null references pnms (id) on delete cascade,
  membership_id uuid not null references memberships (id) on delete cascade,
  body          text not null,
  created_at    timestamptz not null default now()
);
create index on pnm_notes (pnm_id, created_at desc);

-- Row-Level Security.
-- pnms: read = any member · write (create/edit/stage moves) = exec only.
alter table pnms enable row level security;
create policy pnms_read on pnms for select using (is_chapter_member(chapter_id));
create policy pnms_cud  on pnms for all
  using (is_chapter_exec(chapter_id)) with check (is_chapter_exec(chapter_id));

-- pnm_ratings / pnm_votes: read = any member of the PNM's chapter (needed for
-- the average + vote tally) · write = only your own row (rate/vote yourself).
alter table pnm_ratings enable row level security;
create policy pnm_ratings_read on pnm_ratings for select using (
  exists (select 1 from pnms p where p.id = pnm_ratings.pnm_id and is_chapter_member(p.chapter_id))
);
create policy pnm_ratings_mine on pnm_ratings for all
  using (membership_id in (select m.id from memberships m join profiles pr on pr.id = m.profile_id where pr.auth_user_id = auth.uid()))
  with check (membership_id in (select m.id from memberships m join profiles pr on pr.id = m.profile_id where pr.auth_user_id = auth.uid()));

alter table pnm_votes enable row level security;
create policy pnm_votes_read on pnm_votes for select using (
  exists (select 1 from pnms p where p.id = pnm_votes.pnm_id and is_chapter_member(p.chapter_id))
);
create policy pnm_votes_mine on pnm_votes for all
  using (membership_id in (select m.id from memberships m join profiles pr on pr.id = m.profile_id where pr.auth_user_id = auth.uid()))
  with check (membership_id in (select m.id from memberships m join profiles pr on pr.id = m.profile_id where pr.auth_user_id = auth.uid()));

-- pnm_notes: read = any member · insert = any member (as themselves); no
-- update/delete — it's an append-only thread, same as announcements.
alter table pnm_notes enable row level security;
create policy pnm_notes_read on pnm_notes for select using (
  exists (select 1 from pnms p where p.id = pnm_notes.pnm_id and is_chapter_member(p.chapter_id))
);
create policy pnm_notes_insert on pnm_notes for insert with check (
  membership_id in (select m.id from memberships m join profiles pr on pr.id = m.profile_id where pr.auth_user_id = auth.uid())
);

commit;


-- ============================================================================
-- VERIFY — run after all three parts commit successfully.
-- Expect: announcements_now=0, catalog_items=39, logged_entries=0,
--         pnms=0, ratings=0, votes=0, notes=0
-- ============================================================================
select
  (select count(*) from announcements where chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001') as announcements_now,
  (select count(*) from point_items where chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001') as catalog_items,
  (select count(*) from points_entries pe join memberships m on m.id = pe.membership_id where m.chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001') as logged_entries,
  (select count(*) from pnms) as pnms,
  (select count(*) from pnm_ratings) as ratings,
  (select count(*) from pnm_votes) as votes,
  (select count(*) from pnm_notes) as notes;
