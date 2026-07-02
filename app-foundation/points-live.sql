-- ============================================================================
-- Phi Kappa Psi — take POINTS live
-- Run ONCE in the Supabase SQL editor (or via the migration runner), after the
-- roster is loaded.
--   1. adds the point_items catalog table (the sheet's "POINTS (items)" tab)
--   2. wires points_entries to the catalog (item_id) + an approver name
--   3. seeds the real 39-item catalog from the chapter's accountability tracker
--   4. turns on Row-Level Security: read = any chapter member, write = exec
--   5. closes a race: two execs checking in to the same event at once could
--      otherwise create two `meetings` rows for it (meetings.event_id had no
--      uniqueness). One partial unique index fixes both events and points'
--      shared meetings table.
-- After this, "Log points" in the app persists here and the leaderboard reads
-- real data. Core engine only (MAX(-5, sum) + leaderboard) — the sheet's
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

-- Verify: 39 catalog items, 0 entries (clean ledger — nothing logged yet).
select (select count(*) from point_items where chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001') as catalog_items,
       (select count(*) from points_entries pe join memberships m on m.id = pe.membership_id where m.chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001') as logged_entries;
