-- ============================================================================
-- Phi Kappa Psi — Chapter Dashboard
-- Postgres / Supabase schema (the spine of the live app)
-- ============================================================================
--
-- Design principles baked in here (the "be intentional now" decisions):
--   1. MULTI-TENANT from day one. Every row hangs off a chapter_id, even though
--      Cal Beta is the only chapter today. Adding chapters later is then free.
--   2. ROLES LIVE IN THE DATABASE, split into two ideas:
--        - access_role  -> what you can SEE/DO   (member | exec | admin)
--        - position     -> your title            (President, Treasurer, ...)
--      The prototype conflated these; separating them is much more flexible.
--   3. STORE RAW FACTS, DERIVE DASHBOARD NUMBERS. We store payments, points
--      entries, and attendance records — never the percentages. Those come
--      from VIEWs at the bottom. (Mirrors the prototype's computeVals().)
--   4. AUTHORIZATION IS ENFORCED IN THE DB via Row-Level Security, not just
--      hidden in the UI. A member physically cannot SELECT another brother's
--      balance. See the RLS section.
--   5. NO CARD DATA. Payments store a Stripe payment-intent id + status only.
-- ============================================================================

create extension if not exists "pgcrypto";  -- for gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type member_status   as enum ('active', 'new', 'inactive');
create type access_role      as enum ('member', 'exec', 'admin');
create type event_type       as enum ('chapter', 'philanthropy', 'social', 'recruitment', 'service', 'other');
create type rsvp_status       as enum ('going', 'maybe', 'declined', 'no_response');
create type attendance_state as enum ('present', 'excused', 'absent');
create type payment_status    as enum ('succeeded', 'pending', 'failed', 'refunded');

-- ---------------------------------------------------------------------------
-- Core tenancy + identity
-- ---------------------------------------------------------------------------

-- A chapter is the tenant boundary. Everything scopes to it.
create table chapters (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                       -- "Phi Kappa Psi"
  designation  text,                                -- "Cal Beta"
  school       text,                                -- "Stanford"
  created_at   timestamptz not null default now()
);

-- A person the chapter tracks. Identity is DECOUPLED from auth: a profile can
-- exist before (or without) a login — e.g. an alumnus you track, or a pledge
-- the secretary added who hasn't signed up yet. `auth_user_id` links to a
-- Supabase login once they have one; it's null otherwise. This also makes
-- seeding test data trivial (no auth.users rows required).
-- Avatar initials/tint are DERIVED in the app, not stored.
create table profiles (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  full_name    text not null,
  email        text not null unique,
  created_at   timestamptz not null default now()
);

-- Membership ties a person to a chapter and carries everything chapter-specific.
-- A person could (eventually) belong to more than one chapter, so this is the
-- real "member" record the prototype was modeling.
create table memberships (
  id           uuid primary key default gen_random_uuid(),
  chapter_id   uuid not null references chapters (id) on delete cascade,
  profile_id   uuid not null references profiles (id) on delete cascade,
  access_role  access_role  not null default 'member',  -- permissions
  position     text,                                     -- title: "Treasurer", null = no office
  status       member_status not null default 'active',
  class_year   smallint,                                 -- 2026, 2027, ...
  committee    text,
  joined_at    timestamptz not null default now(),
  unique (chapter_id, profile_id)
);
create index on memberships (chapter_id);
create index on memberships (profile_id);

-- ---------------------------------------------------------------------------
-- Terms — scope dues, points, meetings to a period (Spring Term 2026, ...)
-- ---------------------------------------------------------------------------
create table terms (
  id              uuid primary key default gen_random_uuid(),
  chapter_id      uuid not null references chapters (id) on delete cascade,
  name            text not null,                  -- "Spring Term 2026"
  dues_cents      integer not null default 0,     -- standard dues per member, in cents ($850 -> 85000)
  starts_on       date,
  ends_on         date,
  is_current      boolean not null default false
);
create index on terms (chapter_id);

-- ---------------------------------------------------------------------------
-- Events + RSVPs
-- ---------------------------------------------------------------------------
create table events (
  id           uuid primary key default gen_random_uuid(),
  chapter_id   uuid not null references chapters (id) on delete cascade,
  term_id      uuid references terms (id) on delete set null,
  name         text not null,
  type         event_type not null default 'chapter',
  starts_at    timestamptz not null,
  location     text,
  required     boolean not null default false,
  points       integer not null default 0,        -- points awarded for attending
  capacity     integer,
  created_at   timestamptz not null default now()
);
create index on events (chapter_id, starts_at);

create table rsvps (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events (id) on delete cascade,
  membership_id uuid not null references memberships (id) on delete cascade,
  status        rsvp_status not null default 'going',
  created_at    timestamptz not null default now(),
  unique (event_id, membership_id)
);

-- ---------------------------------------------------------------------------
-- Meetings + attendance  (drives "attendance %" and "last 8 meetings")
-- A meeting MAY be backed by an event, or stand alone.
-- ---------------------------------------------------------------------------
create table meetings (
  id           uuid primary key default gen_random_uuid(),
  chapter_id   uuid not null references chapters (id) on delete cascade,
  term_id      uuid references terms (id) on delete set null,
  event_id     uuid references events (id) on delete set null,
  title        text not null,
  held_on      date not null
);
create index on meetings (chapter_id, held_on);

create table attendance (
  id            uuid primary key default gen_random_uuid(),
  meeting_id    uuid not null references meetings (id) on delete cascade,
  membership_id uuid not null references memberships (id) on delete cascade,
  state         attendance_state not null default 'absent',
  unique (meeting_id, membership_id)
);

-- ---------------------------------------------------------------------------
-- Points ledger  (total points = SUM of entries; never store the total)
-- ---------------------------------------------------------------------------
create table points_entries (
  id            uuid primary key default gen_random_uuid(),
  membership_id uuid not null references memberships (id) on delete cascade,
  term_id       uuid references terms (id) on delete set null,
  points        integer not null,
  reason        text,
  event_id      uuid references events (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index on points_entries (membership_id);

-- ---------------------------------------------------------------------------
-- Dues + payments  (balance = SUM(charges) - SUM(succeeded payments))
-- Money is integer cents. Card data is NEVER stored — Stripe holds it.
-- ---------------------------------------------------------------------------
create table dues_charges (
  id            uuid primary key default gen_random_uuid(),
  membership_id uuid not null references memberships (id) on delete cascade,
  term_id       uuid not null references terms (id) on delete cascade,
  amount_cents  integer not null,
  description   text,
  created_at    timestamptz not null default now()
);
create index on dues_charges (membership_id);

create table payments (
  id                       uuid primary key default gen_random_uuid(),
  membership_id            uuid not null references memberships (id) on delete cascade,
  dues_charge_id           uuid references dues_charges (id) on delete set null,
  amount_cents             integer not null,
  status                   payment_status not null default 'pending',
  stripe_payment_intent_id text,                 -- reference only; no PAN/CVV ever
  paid_at                  timestamptz,
  created_at               timestamptz not null default now()
);
create index on payments (membership_id);

-- ---------------------------------------------------------------------------
-- Announcements + reactions + comments  (counts are derived)
-- ---------------------------------------------------------------------------
create table announcements (
  id            uuid primary key default gen_random_uuid(),
  chapter_id    uuid not null references chapters (id) on delete cascade,
  author_id     uuid references memberships (id) on delete set null,
  title         text not null,
  body          text not null,
  pinned        boolean not null default false,
  created_at    timestamptz not null default now()
);
create index on announcements (chapter_id, created_at desc);

create table announcement_reactions (
  announcement_id uuid not null references announcements (id) on delete cascade,
  membership_id   uuid not null references memberships (id) on delete cascade,
  primary key (announcement_id, membership_id)
);

create table announcement_comments (
  id              uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references announcements (id) on delete cascade,
  membership_id   uuid not null references memberships (id) on delete cascade,
  body            text not null,
  created_at      timestamptz not null default now()
);

-- ============================================================================
-- DERIVED VIEWS  (the dashboard reads these — they replace computeVals())
-- ============================================================================
-- CRITICAL: views default to running with the VIEW OWNER's rights, which
-- BYPASSES RLS on the base tables. We set `security_invoker = on` so each view
-- runs with the CALLER's rights and the RLS below actually applies. Because of
-- that, financial columns are split into their own view (member_finances) — a
-- member querying it sees only their own row; everything else is filtered out
-- by the dues/payments RLS policies. Roster data (member_standings) stays
-- readable by every member of the chapter. This split mirrors what the
-- prototype showed each role anyway.

-- Roster rollup: points, attendance %, status. Readable by any chapter member.
create view member_standings
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
  from points_entries group by membership_id
) pts on pts.membership_id = m.id
left join (
  select a.membership_id,
         round(100.0 * count(*) filter (where a.state = 'present') / nullif(count(*),0)) as attendance_pct
  from attendance a group by a.membership_id
) att on att.membership_id = m.id;

-- Per-member FINANCES. security_invoker means dues/payments RLS applies:
-- a member sees only their own row here; exec sees the whole chapter.
create view member_finances
  with (security_invoker = on) as
select
  m.id           as membership_id,
  m.chapter_id,
  coalesce(dc.charged_cents, 0)                                as charged_cents,
  coalesce(pay.paid_cents, 0)                                  as paid_cents,
  coalesce(dc.charged_cents, 0) - coalesce(pay.paid_cents, 0)  as balance_cents,
  case
    when coalesce(dc.charged_cents,0) = 0 then 'paid'
    when coalesce(pay.paid_cents,0) >= coalesce(dc.charged_cents,0) then 'paid'
    when coalesce(pay.paid_cents,0) > 0 then 'partial'
    else 'due'
  end                                                          as dues_state
from memberships m
left join (
  select membership_id, sum(amount_cents) as charged_cents
  from dues_charges group by membership_id
) dc on dc.membership_id = m.id
left join (
  select membership_id, sum(amount_cents) as paid_cents
  from payments where status = 'succeeded' group by membership_id
) pay on pay.membership_id = m.id;

-- Chapter-level AGGREGATE stats (the four exec cards + sidebar "% collected").
-- Deliberately runs as DEFINER (security_invoker off): it returns only chapter
-- totals — never a per-member row — so it leaks no individual balance, and the
-- aggregate "% dues collected" is shown to members in the prototype sidebar.
-- Scope reads to chapter members at the app layer (it has no own RLS).
create view chapter_stats as
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
         round(100.0 * count(*) filter (where a.state='present') / nullif(count(*),0)) as attendance_pct
  from attendance a group by a.membership_id
) att on att.membership_id = m.id
group by m.chapter_id;

-- ============================================================================
-- ROW-LEVEL SECURITY  (the exec/member boundary, enforced by Postgres)
-- ============================================================================
-- Helper: does the current auth user have exec/admin access in this chapter?
create or replace function is_chapter_exec(p_chapter uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from memberships m
    join profiles p on p.id = m.profile_id
    where m.chapter_id = p_chapter
      and p.auth_user_id = auth.uid()
      and m.access_role in ('exec', 'admin')
  );
$$;

-- Helper: is the current auth user any member of this chapter?
create or replace function is_chapter_member(p_chapter uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from memberships m
    join profiles p on p.id = m.profile_id
    where m.chapter_id = p_chapter and p.auth_user_id = auth.uid()
  );
$$;

alter table memberships    enable row level security;
alter table dues_charges   enable row level security;
alter table payments       enable row level security;
alter table announcements  enable row level security;

-- Roster basics are visible to every member of the chapter.
create policy roster_read on memberships
  for select using (is_chapter_member(chapter_id));

-- FINANCES: a member sees only their OWN dues; exec sees the whole chapter.
create policy dues_read on dues_charges
  for select using (
    membership_id in (
      select m.id from memberships m join profiles p on p.id = m.profile_id
      where p.auth_user_id = auth.uid()
    )
    or is_chapter_exec((select chapter_id from memberships where id = dues_charges.membership_id))
  );
create policy payments_read on payments
  for select using (
    membership_id in (
      select m.id from memberships m join profiles p on p.id = m.profile_id
      where p.auth_user_id = auth.uid()
    )
    or is_chapter_exec((select chapter_id from memberships where id = payments.membership_id))
  );

-- Announcements: any member reads; only exec writes.
create policy ann_read  on announcements for select using (is_chapter_member(chapter_id));
create policy ann_write on announcements for insert with check (is_chapter_exec(chapter_id));

-- NOTE: events, rsvps, meetings, points, etc. need their own policies too —
-- same pattern (read = is_chapter_member, write = is_chapter_exec, with RSVPs
-- writable by the member themselves). Left as the obvious next pass.
