-- ---------------------------------------------------------------------------
-- Points & Attendance — standalone app schema (own Supabase project, no
-- shared tables/RLS with the chapter app). Run once against a fresh project,
-- then create exec logins by hand in the Supabase Auth dashboard (Authentication
-- → Users → Add user) — there is no signup flow.
--
-- Auth model: this app has no member accounts and no role table. Any
-- `authenticated` user IS exec (the only accounts that will ever exist are the
-- few exec logins created by hand above), so every write policy below just
-- checks `auth.role() = 'authenticated'`. `anon` gets SELECT on the four
-- tables the public /board page reads (members, point_items, points_entries,
-- settings) and nothing else — anon is the key shipped in the browser bundle,
-- so this is the actual security boundary, not the UI.
--
-- Safe to re-run (all `if not exists`).
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

-- ─────────────────────────── Members ───────────────────────────
-- Minimal roster: points attach to someone. No auth_user_id, no login.
create table if not exists members (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  photo_url  text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────── Terms ───────────────────────────
-- Lightweight: exists only so max_per_term has something to scope by. No
-- reset-each-term logic, no quarter/academic-year date math — just a label
-- and a current flag an exec flips via "Start new term".
create table if not exists terms (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists terms_one_current_idx on terms (is_current) where is_current;

-- ─────────────────────────── Catalog ───────────────────────────
create table if not exists point_items (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  points        int not null default 0,                  -- catalog value; 0 when discretionary
  kind          text not null check (kind in ('reward', 'punishment')),
  discretionary boolean not null default false,           -- exec sets the value per entry
  archived      boolean not null default false,           -- soft-delete: hidden from pickers, join stays valid
  sort_order    int not null default 0,
  max_per_term  int,                                      -- per-member cap per term; null = unlimited
  auto_trigger  text check (auto_trigger in ('present', 'late', 'absent', 'excused'))
                -- deliberately excludes 'abroad' — auto-award only fires off a
                -- real per-meeting mark, never the standing abroad status.
);
create index if not exists point_items_active_idx on point_items (sort_order) where not archived;

-- ─────────────────────────── Meetings ───────────────────────────
create table if not exists meetings (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  held_on    date not null,
  term_id    uuid references terms (id),
  created_at timestamptz not null default now()
);

-- ─────────────────────────── Points ledger ───────────────────────────
-- No status column — no member self-log/request queue exists in this app, so
-- every row here is an exec-logged entry and counts immediately. item_id is
-- NOT NULL: items are only ever archived, never deleted, so the join always
-- resolves (the archive rationale — keep past rows' real label — needs no
-- denormalized label column as a result).
create table if not exists points_entries (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references members (id) on delete cascade,
  item_id     uuid not null references point_items (id),
  points      int not null,
  logged_by   text not null,
  term_id     uuid references terms (id),
  meeting_id  uuid references meetings (id) on delete cascade,  -- set only for auto-award rows
  created_at  timestamptz not null default now()
);
create index if not exists points_entries_member_idx on points_entries (member_id);
create index if not exists points_entries_term_idx on points_entries (term_id);
create index if not exists points_entries_meeting_idx on points_entries (meeting_id);

-- ─────────────────────────── Attendance ───────────────────────────
create table if not exists attendance (
  meeting_id uuid not null references meetings (id) on delete cascade,
  member_id  uuid not null references members (id) on delete cascade,
  state      text not null check (state in ('present', 'late', 'absent', 'excused', 'abroad')),
  primary key (meeting_id, member_id)
);

-- A member's standing status for the current term (abroad, or a recurring
-- excuse) — seeds the attendance grid so exec doesn't re-mark it every
-- meeting. Saving attendance still writes a real per-meeting `state` row
-- (mapped from the standing status, e.g. abroad → 'abroad'), so
-- attendancePctFrom's present/(present+absent) math has a real row to read.
create table if not exists member_term_statuses (
  member_id  uuid not null references members (id) on delete cascade,
  term_id    uuid not null references terms (id) on delete cascade,
  kind       text not null check (kind in ('abroad', 'excused')),
  reason     text,
  primary key (member_id, term_id)
);

-- ─────────────────────────── Settings (singleton) ───────────────────────────
create table if not exists settings (
  id             int primary key default 1 check (id = 1),
  points_floor   int not null default -5,
  points_ceiling int
);

-- ─────────────────────────── Seed (day-one rows) ───────────────────────────
-- Without these, recordAttendance/points capping have no current term to
-- scope by, and the settings read has no row to clamp against.
insert into terms (label, is_current)
  select 'Term 1', true
  where not exists (select 1 from terms where is_current);

insert into settings (id, points_floor, points_ceiling)
  values (1, -5, null)
  on conflict (id) do nothing;

-- ─────────────────────────── RLS ───────────────────────────
alter table members              enable row level security;
alter table terms                enable row level security;
alter table point_items           enable row level security;
alter table meetings               enable row level security;
alter table points_entries         enable row level security;
alter table attendance             enable row level security;
alter table member_term_statuses   enable row level security;
alter table settings               enable row level security;

-- Public read (the /board page uses the anon key, no session).
drop policy if exists members_read_public on members;
create policy members_read_public on members for select using (true);

drop policy if exists point_items_read_public on point_items;
create policy point_items_read_public on point_items for select using (true);

drop policy if exists points_entries_read_public on points_entries;
create policy points_entries_read_public on points_entries for select using (true);

drop policy if exists settings_read_public on settings;
create policy settings_read_public on settings for select using (true);

-- Exec-only read (nothing in /board needs these). `to authenticated` targets
-- the role directly rather than checking auth.role() in the predicate (that
-- helper is deprecated/absent on newer Supabase projects) — this form is the
-- documented one and can't silently evaluate to false.
drop policy if exists terms_read_exec on terms;
create policy terms_read_exec on terms for select to authenticated using (true);

drop policy if exists meetings_read_exec on meetings;
create policy meetings_read_exec on meetings for select to authenticated using (true);

drop policy if exists attendance_read_exec on attendance;
create policy attendance_read_exec on attendance for select to authenticated using (true);

drop policy if exists member_term_statuses_read_exec on member_term_statuses;
create policy member_term_statuses_read_exec on member_term_statuses for select to authenticated using (true);

-- Exec-only writes on every table (any authenticated user = exec — see header).
drop policy if exists members_write_exec on members;
create policy members_write_exec on members for all
  to authenticated using (true) with check (true);

drop policy if exists terms_write_exec on terms;
create policy terms_write_exec on terms for all
  to authenticated using (true) with check (true);

drop policy if exists point_items_write_exec on point_items;
create policy point_items_write_exec on point_items for all
  to authenticated using (true) with check (true);

drop policy if exists meetings_write_exec on meetings;
create policy meetings_write_exec on meetings for all
  to authenticated using (true) with check (true);

drop policy if exists points_entries_write_exec on points_entries;
create policy points_entries_write_exec on points_entries for all
  to authenticated using (true) with check (true);

drop policy if exists attendance_write_exec on attendance;
create policy attendance_write_exec on attendance for all
  to authenticated using (true) with check (true);

drop policy if exists member_term_statuses_write_exec on member_term_statuses;
create policy member_term_statuses_write_exec on member_term_statuses for all
  to authenticated using (true) with check (true);

drop policy if exists settings_write_exec on settings;
create policy settings_write_exec on settings for all
  to authenticated using (true) with check (true);
