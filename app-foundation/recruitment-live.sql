-- ============================================================================
-- Phi Kappa Psi — take RECRUITMENT / RUSH CRM live
-- Run ONCE in the Supabase SQL editor (or via the migration runner), after the
-- roster is loaded. Creates the 4 tables the Recruitment module needs (none
-- exist yet — this vertical has been mock-only since it was built):
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

-- Verify: 4 new tables, 0 rows (clean slate — add real PNMs from the app).
select
  (select count(*) from pnms) as pnms,
  (select count(*) from pnm_ratings) as ratings,
  (select count(*) from pnm_votes) as votes,
  (select count(*) from pnm_notes) as notes;
