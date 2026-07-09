-- ---------------------------------------------------------------------------
-- Points engine rules + auto-award (Phases 2 & 3 of admin-customizable points)
--
-- Phase 2 — engine rules:
--   * chapters gains points_floor / points_ceiling / points_reset_each_term
--     (the client engine reads these; the -5 floor was always client-side, so
--     this just makes the existing knob configurable + adds a ceiling + reset).
--   * point_items gains max_per_term (per-member-per-term cap; null = unlimited).
--   * every insert path stamps term_id (was previously left null on exec logs),
--     and existing null rows are backfilled to the current term.
--
-- Phase 3 — auto-award (option C) + self-log flags:
--   * point_items.auto_trigger: when set to an attendance state, the item is
--     auto-awarded when a member is recorded in that state, and is REMOVED from
--     the manual Log-points picker (attendance owns it — no double-counting).
--   * points_entries.meeting_id ties an auto-award to its meeting so re-saving
--     attendance replaces (not duplicates) the auto entries.
--   * point_items.self_loggable overrides the "reward + non-discretionary" rule
--     for who members may self-log; auto_approve lands a self-log as approved.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------------

begin;

-- 1. Chapter-wide scoring config.
alter table chapters
  add column if not exists points_floor           int     not null default -5,
  add column if not exists points_ceiling         int,                       -- null = no cap
  add column if not exists points_reset_each_term boolean not null default false;

-- 2. Per-item rules.
alter table point_items
  add column if not exists max_per_term  int,                                -- null = unlimited
  add column if not exists auto_trigger  text
    check (auto_trigger in ('present', 'late', 'absent', 'excused')),        -- null = manual
  add column if not exists self_loggable boolean,                            -- null = default rule
  add column if not exists auto_approve  boolean not null default false;

-- 3. Tie an entry to the meeting that produced it (auto-award idempotency).
alter table points_entries
  add column if not exists meeting_id uuid references meetings (id) on delete cascade;
create index if not exists points_entries_meeting_idx on points_entries (meeting_id);

-- 4. Backfill term_id on existing rows to the chapter's current term.
update points_entries pe
   set term_id = t.id
  from memberships m
  join terms t on t.chapter_id = m.chapter_id and t.is_current
 where pe.membership_id = m.id
   and pe.term_id is null;

-- 5. Self-log RLS: honor self_loggable (default = reward & non-discretionary),
--    never allow auto-owned or archived items, and permit an APPROVED insert
--    only for auto_approve items (so auto-approve needs no privileged trigger).
drop policy if exists points_entries_self_request on points_entries;
create policy points_entries_self_request on points_entries for insert
  with check (
    membership_id in (
      select m.id from memberships m join profiles p on p.id = m.profile_id
      where p.auth_user_id = auth.uid()
    )
    and exists (
      select 1 from point_items pi
      where pi.id = points_entries.item_id
        and pi.discretionary = false
        and pi.points = points_entries.points
        and pi.auto_trigger is null
        and coalesce(pi.archived, false) = false
        and coalesce(pi.self_loggable, pi.kind = 'reward') = true
    )
    and (
      status = 'pending'
      or (status = 'approved' and exists (
        select 1 from point_items pi2 where pi2.id = points_entries.item_id and pi2.auto_approve
      ))
    )
  );

commit;
