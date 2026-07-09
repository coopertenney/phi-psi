-- ============================================================================
-- Phi Kappa Psi — seed / validation data
-- Run AFTER schema.sql, in the Supabase SQL editor (runs as the postgres role,
-- which bypasses RLS — so this populates freely).
--
-- The data mirrors the prototype's mock roster so the DERIVED VIEWS should
-- reproduce its headline numbers. After running, check:
--   select * from chapter_stats;
--     active_members = 11, total_members = 12,
--     paid_count = 6, partial_count = 3, due_count = 3,
--     collected_cents = 660000 ($6,600), target_cents = 1020000 ($10,200)  -> 65%
-- Attendance % is now DERIVED from meeting records, so it quantizes to 1/8
-- (12.5%) steps and won't match the prototype's hand-picked figures exactly.
-- ============================================================================

begin;

-- Deterministic ids so re-reading the seed is easy.
insert into chapters (id, name, designation, school) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Phi Kappa Psi', 'Cal Beta', 'Stanford');

insert into terms (id, chapter_id, name, dues_cents, starts_on, ends_on, is_current) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Spring Term 2026', 85000, '2026-01-06', '2026-06-12', true);

-- Staging table keyed by email (unique), so child rows can join back to it.
create temp table seed_members (
  full_name   text,
  email       text,
  access_role access_role,
  position    text,
  status      member_status,
  class_year  smallint,
  committee   text,
  dues        text,      -- paid | partial | due  (drives the payment row)
  points      integer,
  present     integer    -- meetings attended out of 8
) on commit drop;

insert into seed_members values
  ('Marcus Chen',   'mchen@stanford.edu',    'admin',  'President',         'active',   2026, 'Executive',        'paid',    480, 8),
  ('Aisha Patel',   'apatel@stanford.edu',   'exec',   'Treasurer',         'active',   2027, 'Finance',          'paid',    462, 8),
  ('Diego Ramirez', 'dramirez@stanford.edu', 'exec',   'Vice President',    'active',   2026, 'Executive',        'paid',    445, 8),
  ('Jordan Avery',  'javery@stanford.edu',   'exec',   'Recruitment Chair', 'active',   2027, 'Recruitment',      'partial', 410, 7),
  ('Tyler Brooks',  'tbrooks@stanford.edu',  'exec',   'Social Chair',      'active',   2027, 'Social',           'paid',    388, 7),
  ('Noah Williams', 'nwilliams@stanford.edu','exec',   'Philanthropy Chair','active',   2028, 'Service',          'paid',    372, 7),
  ('Ethan Park',    'epark@stanford.edu',    'exec',   'Secretary',         'active',   2028, 'Executive',        'partial', 355, 7),
  ('Liam Foster',   'lfoster@stanford.edu',  'exec',   'Risk Manager',      'active',   2026, 'Standards',        'paid',    340, 7),
  ('Caleb Nguyen',  'cnguyen@stanford.edu',  'member', null,                'active',   2028, 'Social',           'due',     295, 6),
  ('Owen Mitchell', 'omitchell@stanford.edu','member', null,                'new',      2029, 'New Member Class', 'partial', 180, 8),
  ('Sam Rivera',    'srivera@stanford.edu',  'member', null,                'new',      2029, 'New Member Class', 'due',     150, 7),
  ('Henry Cole',    'hcole@stanford.edu',    'member', null,                'inactive', 2027, 'Unassigned',       'due',      90, 3);

-- Profiles (identity decoupled from auth → no auth.users rows needed for seed).
insert into profiles (full_name, email)
  select full_name, email from seed_members;

-- Memberships.
insert into memberships (chapter_id, profile_id, access_role, position, status, class_year, committee)
  select 'aaaaaaaa-0000-0000-0000-000000000001', p.id, sm.access_role, sm.position, sm.status, sm.class_year, sm.committee
  from seed_members sm join profiles p on p.email = sm.email;

-- Dues: every member charged the standard term dues.
insert into dues_charges (membership_id, term_id, amount_cents, description)
  select m.id, 'bbbbbbbb-0000-0000-0000-000000000001', 85000, 'Spring Term 2026 dues'
  from memberships m;

-- Payments: paid -> full, partial -> $500, due -> no payment row.
insert into payments (membership_id, amount_cents, status, paid_at)
  select m.id,
         case sm.dues when 'paid' then 85000 when 'partial' then 50000 end,
         'succeeded', now()
  from memberships m
  join profiles p on p.id = m.profile_id
  join seed_members sm on sm.email = p.email
  where sm.dues <> 'due';

-- Points: one ledger entry per member carrying their term total.
insert into points_entries (membership_id, term_id, points, reason)
  select m.id, 'bbbbbbbb-0000-0000-0000-000000000001', sm.points, 'Spring Term 2026 total (seed)'
  from memberships m
  join profiles p on p.id = m.profile_id
  join seed_members sm on sm.email = p.email;

-- Meetings: 8 weekly chapter meetings.
insert into meetings (id, chapter_id, term_id, title, held_on)
  select gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001',
         'bbbbbbbb-0000-0000-0000-000000000001',
         'Chapter Meeting ' || g, date '2026-02-01' + ((g - 1) * 7)
  from generate_series(1, 8) g;

-- Attendance: mark each member 'present' for their first N meetings, else 'absent'.
insert into attendance (meeting_id, membership_id, state)
  select x.meeting_id, x.membership_id,
         (case when x.rn <= x.present then 'present' else 'absent' end)::attendance_state
  from (
    select mt.id as meeting_id, m.id as membership_id, sm.present,
           row_number() over (partition by m.id order by mt.held_on) as rn
    from meetings mt
    cross join memberships m
    join profiles p on p.id = m.profile_id
    join seed_members sm on sm.email = p.email
  ) x;

-- Events (April 2026). RSVPs are handled in Partiful (each social carries an
-- optional partiful_url — see events-partiful.sql), so none are seeded here.
insert into events (chapter_id, term_id, name, type, starts_at, location, required, points, capacity) values
  ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Weekly Chapter Meeting','chapter',     '2026-04-12 19:00-07','Chapter House',  true,  10, 52),
  ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Spring Philanthropy 5K','philanthropy', '2026-04-15 09:00-07','Lake Lagunita',  false, 25, 52),
  ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Founders Day Formal',   'social',       '2026-04-19 20:00-07','Rosewood Hotel', false, 15, 52),
  ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Recruitment Info Night','recruitment',  '2026-04-22 18:30-07','Tresidder Union',true,  10, 52),
  ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Alumni Spring BBQ',     'social',       '2026-04-26 12:00-07','Wilbur Field',   false, 10, 52);

-- Announcements (author = the member who posted).
insert into announcements (chapter_id, author_id, title, body, pinned)
  select 'aaaaaaaa-0000-0000-0000-000000000001', m.id, a.title, a.body, a.pinned
  from (values
    ('apatel@stanford.edu',   'Spring dues are due April 15',
     'Final reminder that spring term dues are due by April 15. Anyone on a payment plan should have their second installment in by then. Balances must be cleared before the Founders Day Formal.', true),
    ('nwilliams@stanford.edu','Volunteers needed for the Philanthropy 5K',
     'We still need 8 brothers to help with setup, registration, and water stations on the morning of the 15th. Volunteer slots earn 15 service points each.', false),
    ('tbrooks@stanford.edu',  'Founders Day Formal tickets are live',
     'Tickets for the Founders Day Formal at the Rosewood are now available. Guest list and ticket sales close Friday at midnight.', false),
    ('mchen@stanford.edu',    'Chapter GPA reached an all-time high',
     'Proud to share that Cal Beta posted a 3.41 cumulative GPA this term, the highest in chapter history. Thank you to everyone who showed up to study tables.', false)
  ) as a(email, title, body, pinned)
  join profiles p on p.email = a.email
  join memberships m on m.profile_id = p.id;

commit;
