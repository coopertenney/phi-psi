-- ───────────────────────────────────────────────────────────────────────────
-- Per-member "read" tracking for announcements. A member marks an announcement
-- read; the app shows unread ones as new and a "No new announcements" state
-- once everything's read. (Groundwork for the exec "who's seen it / re-notify"
-- view later — not built yet.)
--
-- HARD GATE: run this BEFORE the app code references announcement_reads, or the
-- Announcements tab 500s. Run via the Supabase SQL editor or Management API.
-- ───────────────────────────────────────────────────────────────────────────
begin;

create table if not exists announcement_reads (
  announcement_id uuid not null references announcements (id) on delete cascade,
  membership_id   uuid not null references memberships (id)   on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, membership_id)
);
create index if not exists announcement_reads_membership_idx on announcement_reads (membership_id);

-- New tables made via the SQL channel don't always inherit role grants
-- (this project's drop-schema reset wiped them once) — grant explicitly.
grant select, insert, update, delete on announcement_reads to authenticated;

-- RLS: a member sees + writes only their OWN read rows. Same self-write shape
-- as rsvps / pnm_votes; the with check is what lets a plain member (not just
-- exec) insert their own "read" row.
alter table announcement_reads enable row level security;
drop policy if exists announcement_reads_mine on announcement_reads;
create policy announcement_reads_mine on announcement_reads for all
  using (membership_id in (
    select m.id from memberships m join profiles p on p.id = m.profile_id
    where p.auth_user_id = auth.uid()))
  with check (membership_id in (
    select m.id from memberships m join profiles p on p.id = m.profile_id
    where p.auth_user_id = auth.uid()));

commit;

select count(*) as reads_now from announcement_reads;
