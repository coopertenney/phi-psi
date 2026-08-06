-- Roll Call App — initial schema (v1)

create extension if not exists "pgcrypto";

create table rosters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table people (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null references rosters(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index people_roster_id_idx on people(roster_id);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null references rosters(id) on delete cascade,
  date date not null,
  label text,
  created_at timestamptz not null default now()
);
create index sessions_roster_id_idx on sessions(roster_id);

create type attendance_status as enum ('present', 'absent');

create table attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  status attendance_status,
  excused boolean not null default false,
  arrived_late boolean not null default false,
  left_early boolean not null default false,
  arrival_time time,
  departure_time time,
  updated_at timestamptz not null default now(),
  unique (session_id, person_id)
);
create index attendance_session_id_idx on attendance(session_id);
create index attendance_person_id_idx on attendance(person_id);

create table excusal_rules (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  reason text,
  start_date date not null,
  end_date date
);
create index excusal_rules_person_id_idx on excusal_rules(person_id);

create table study_abroad_periods (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text
);
create index study_abroad_periods_person_id_idx on study_abroad_periods(person_id);

-- updated_at auto-bump on attendance
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger attendance_set_updated_at
  before update on attendance
  for each row execute function set_updated_at();

-- Row Level Security: 1-3 known admins share one Supabase project, so any
-- authenticated user is treated as an admin with full read/write access.
alter table rosters enable row level security;
alter table people enable row level security;
alter table sessions enable row level security;
alter table attendance enable row level security;
alter table excusal_rules enable row level security;
alter table study_abroad_periods enable row level security;

create policy "admins full access" on rosters
  for all to authenticated using (true) with check (true);
create policy "admins full access" on people
  for all to authenticated using (true) with check (true);
create policy "admins full access" on sessions
  for all to authenticated using (true) with check (true);
create policy "admins full access" on attendance
  for all to authenticated using (true) with check (true);
create policy "admins full access" on excusal_rules
  for all to authenticated using (true) with check (true);
create policy "admins full access" on study_abroad_periods
  for all to authenticated using (true) with check (true);
