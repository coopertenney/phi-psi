-- ============================================================================
-- Phi Kappa Psi — take LINEAGE (big/little) live
-- Run ONCE in the Supabase SQL editor, AFTER the roster is loaded (load-roster.sql
-- / roster-update-*.sql / roster-add-alumni.sql / roster-add-ancestors.sql).
-- Idempotent: safe to re-run — it clears and reloads the chapter's lineage rows,
-- and CREATE OR REPLACE re-points the view.
--
-- What it does:
--   1. `lineage` table — a little links to one OR MORE bigs (twin bigs). A big may
--      be a current membership (big_membership_id) or an alum (name only).
--   2. member_standings view — adds big_name (bigs joined " & ") + little_names[].
--      Reproduced from attendance-v2.sql (the current authoritative view) with the
--      two lineage columns appended — nothing else changes.
--   3. RLS: read = any chapter member · write = exec.
--   4. Populates 158 links: 106 for the active/alumni roster (bigs matched by
--      email) + 52 ancestor→big links from the Figma "7-5" tree (littles keyed by
--      the synthetic @lineage.invalid emails from roster-add-ancestors.sql).
--   5. Backfills big_membership_id by name so the ancestors + the old name-only
--      anchors link to real membership rows (populating little_names).
-- The app already reads s.big_name / s.little_names — no code change needed.
--
-- ⚠️  RUN roster-add-ancestors.sql BEFORE this. The 52 ancestor links resolve
--     their little_id via those synthetic emails; without the profiles they
--     silently no-op (the insert's join drops them).
-- ============================================================================

begin;

-- 1. Table -------------------------------------------------------------------
create table if not exists lineage (
  id                uuid primary key default gen_random_uuid(),
  chapter_id        uuid not null references chapters (id) on delete cascade,
  little_id         uuid not null references memberships (id) on delete cascade,
  big_membership_id uuid references memberships (id) on delete set null,  -- null = alum
  big_name          text not null,                                        -- display name (alum or current)
  ord               smallint not null default 0,                          -- 0,1 order for twin bigs
  unique (little_id, big_name)
);
create index if not exists lineage_chapter_idx on lineage (chapter_id);
create index if not exists lineage_little_idx  on lineage (little_id);
create index if not exists lineage_big_idx     on lineage (big_membership_id);

-- 2. RLS ---------------------------------------------------------------------
alter table lineage enable row level security;
drop policy if exists lineage_read on lineage;
drop policy if exists lineage_cud  on lineage;
create policy lineage_read on lineage for select using (is_chapter_member(chapter_id));
create policy lineage_cud  on lineage for all
  using (is_chapter_exec(chapter_id)) with check (is_chapter_exec(chapter_id));
grant select, insert, update, delete on lineage to authenticated;

-- 3. member_standings — append big_name + little_names ------------------------
create or replace view member_standings
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
  coalesce(att.attendance_pct, 0) as attendance_pct,
  p.avatar_url,
  (select string_agg(coalesce(bp.full_name, l.big_name), ' & ' order by l.ord, l.big_name)
     from lineage l
     left join memberships bm on bm.id = l.big_membership_id
     left join profiles    bp on bp.id = bm.profile_id
     where l.little_id = m.id)                             as big_name,
  (select array_agg(lp.full_name order by lp.full_name)
     from lineage l
     join memberships lm on lm.id = l.little_id
     join profiles    lp on lp.id = lm.profile_id
     where l.big_membership_id = m.id)                     as little_names
from memberships m
join profiles p on p.id = m.profile_id
left join (
  select membership_id, sum(points) as total_points
  from points_entries where status = 'approved' group by membership_id
) pts on pts.membership_id = m.id
left join (
  select a.membership_id,
         round(100.0 * count(*) filter (where a.state = 'present')
                     / nullif(count(*) filter (where a.state in ('present', 'absent')), 0)) as attendance_pct
  from attendance a group by a.membership_id
) att on att.membership_id = m.id;

-- 4. Populate ----------------------------------------------------------------
delete from lineage where chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001';

create temp table lineage_stage (little_email text, big_email text, big_name text, ord smallint)
  on commit drop;
insert into lineage_stage (little_email, big_email, big_name, ord) values
  ('jmkoch@stanford.edu', 'kyles7@stanford.edu', 'Kyle Schmoyer', 0),
  ('saulh22@stanford.edu', 'asdaix@stanford.edu', 'Alexander Daix', 0),
  ('lcahilly@stanford.edu', 'jmtubb1@stanford.edu', 'Jonathan Tubb', 0),
  ('grahamjo@stanford.edu', NULL, 'Chehan Wijayaratne', 0),
  ('zpewing@stanford.edu', 'mjhemker@stanford.edu', 'Michael Hemker', 0),
  ('samshors@stanford.edu', NULL, 'Nolan Mejia', 0),
  ('cousinss@stanford.edu', 'bkbush@stanford.edu', 'Bradley Bush', 0),
  ('aleick@stanford.edu', 'sjonker@stanford.edu', 'Sam Jonker', 0),
  ('benjiw@stanford.edu', 'panapap@stanford.edu', 'Panos Papanastasiou', 0),
  ('ctenney@stanford.edu', 'saulh22@stanford.edu', 'Saul Hernandez Vigil', 0),
  ('endur@stanford.edu', 'jamesu72@stanford.edu', 'James Ubi', 0),
  ('efrainac@stanford.edu', NULL, 'Milo Golding', 0),
  ('kyles7@stanford.edu', NULL, 'Gareth Cockroft', 0),
  ('tuvana@stanford.edu', 'dcureton@stanford.edu', 'Dean Cureton', 0),
  ('mtsolis@stanford.edu', 'abelfior@stanford.edu', 'Alexander Belfiore', 0),
  ('jcberdej@stanford.edu', 'jonath4n@stanford.edu', 'Jonathan Morales', 0),
  ('viveky@stanford.edu', 'mtsolis@stanford.edu', 'Mateo Solis', 0),
  ('panapap@stanford.edu', NULL, 'Lichu Acuna', 0),
  ('aclaire@stanford.edu', NULL, 'Anthony Chen', 0),
  ('jdmoyer@stanford.edu', 'zpewing@stanford.edu', 'Zachary Ewing', 0),
  ('wohlberg@stanford.edu', 'ooo@stanford.edu', 'Ben McAulay', 0),
  ('modesitt@stanford.edu', 'carterd1@stanford.edu', 'Carter Dessommes', 0),
  ('jkarlson@stanford.edu', 'dgohill@stanford.edu', 'Dilan Gohill', 0),
  ('owengrossman@stanford.edu', 'endur@stanford.edu', 'Eddy Duran', 0),
  ('connor1@stanford.edu', NULL, 'Ping Tankongchamruskul', 0),
  ('ooo@stanford.edu', NULL, 'Odin Farkas', 0),
  ('bpigott@stanford.edu', NULL, 'Nick Dietrich', 0),
  ('chrisvg@stanford.edu', 'benbchen@stanford.edu', 'Benjamin Chen', 0),
  ('jonaspao@stanford.edu', NULL, 'Adri Arquin', 0),
  ('jamesu72@stanford.edu', NULL, 'Esteban Herrera-Vendrell', 0),
  ('dcureton@stanford.edu', NULL, 'Ethan Kirgan', 0),
  ('shawng28@stanford.edu', 'aclaire@stanford.edu', 'Arjin Claire', 0),
  ('shawng28@stanford.edu', 'atiao@stanford.edu', 'Aaron Tiao', 1),
  ('zackryan@stanford.edu', NULL, 'Garin Gross', 0),
  ('mjhemker@stanford.edu', NULL, 'Ezra Kohrman', 0),
  ('mweis2@stanford.edu', NULL, 'Ethan Tiao', 0),
  ('gmurga@stanford.edu', 'endur@stanford.edu', 'Eddy Duran', 0),
  ('petermcg@stanford.edu', 'gport@stanford.edu', 'George Porteous', 0),
  ('deanl@stanford.edu', 'jasonbz@stanford.edu', 'Jason Zhang', 0),
  ('griffin2@stanford.edu', 'zackryan@stanford.edu', 'Zack Ryan', 0),
  ('asdaix@stanford.edu', NULL, 'Dhruv Sumathi', 0),
  ('aledarb@stanford.edu', 'connor1@stanford.edu', 'Connor Lee', 0),
  ('noemtz@stanford.edu', 'efrainac@stanford.edu', 'Efrain Angon-Cruz', 0),
  ('dsih@stanford.edu', 'hdboesch@stanford.edu', 'Henry Boeschen', 0),
  ('thijs@stanford.edu', 'jmkoch@stanford.edu', 'Joshua Koch', 0),
  ('walshp26@stanford.edu', NULL, 'Michael Chhay', 0),
  ('ayeung16@stanford.edu', 'zaydanka@stanford.edu', 'Zaydan Amanullah', 0),
  ('abelfior@stanford.edu', NULL, 'Ethan Kato', 0),
  ('carlov@stanford.edu', 'jcberdej@stanford.edu', 'Jose Berdeja', 0),
  ('mbdolan@stanford.edu', 'jonaspao@stanford.edu', 'Jonas Pao', 0),
  ('joshbars@stanford.edu', NULL, 'Benji Welner', 0),
  ('carterd1@stanford.edu', 'grahamjo@stanford.edu', 'Graham Johnstone', 0),
  ('jonath4n@stanford.edu', NULL, 'Sam Kwok', 0),
  ('jonath4n@stanford.edu', NULL, 'Yahir Ruiz', 1),
  ('jka@stanford.edu', 'krisluo@stanford.edu', 'Kristopher Luo', 0),
  ('cpierre@stanford.edu', 'yannickm@stanford.edu', 'Yannick Mofor', 0),
  ('aaroncl@stanford.edu', NULL, 'Sidd Wali', 0),
  ('dgohill@stanford.edu', NULL, 'Nick Buckovich', 0),
  ('jmtubb1@stanford.edu', NULL, 'Ethan Bernheim', 0),
  ('zkhuang@stanford.edu', 'aaroncl@stanford.edu', 'Aaron Lee', 0),
  ('gport@stanford.edu', 'walshp26@stanford.edu', 'Patrick Walsh', 0),
  ('bkbush@stanford.edu', NULL, 'Theo Snoey', 0),
  ('hdboesch@stanford.edu', NULL, 'Deveen Harsichandra', 0),
  ('atiao@stanford.edu', NULL, 'Maxim Ivanov', 0),
  ('benbchen@stanford.edu', 'samshors@stanford.edu', 'Sam Shors', 0),
  ('sjonker@stanford.edu', 'mweis2@stanford.edu', 'Mercer Weis', 0),
  ('zaydanka@stanford.edu', 'bpigott@stanford.edu', 'Blake Pigott', 0),
  ('jasonbz@stanford.edu', NULL, 'Michael Brockman', 0),
  ('yannickm@stanford.edu', NULL, 'Titus Parker', 0),
  ('krisluo@stanford.edu', NULL, 'Andrew Park', 0),
  ('benvu@stanford.edu', 'griffin2@stanford.edu', 'Griffin Lee', 0),
  ('bisonmh@stanford.edu', 'jdmoyer@stanford.edu', 'Jackson Moyer', 0),
  ('burkema@stanford.edu', 'wohlberg@stanford.edu', 'Alex Wohlberg', 0),
  ('cwason06@stanford.edu', 'thijs@stanford.edu', 'Thijs Simonian', 0),
  ('connorfe@stanford.edu', 'viveky@stanford.edu', 'Vivek Yarlagedda', 0),
  ('bschind@stanford.edu', 'benjiw@stanford.edu', 'Benji Warburton', 0),
  ('sanjayde@stanford.edu', 'aleick@stanford.edu', 'Andrew Leick', 0),
  ('wmaher@stanford.edu', 'modesitt@stanford.edu', 'Brooks Modesitt', 0),
  ('shrishp@stanford.edu', 'shawng28@stanford.edu', 'Shawn Gregory', 0),
  ('csimonia@stanford.edu', 'joshbars@stanford.edu', 'Josh Barsoian', 0),
  ('tejk@stanford.edu', 'aleick@stanford.edu', 'Andrew Leick', 0),
  ('atamura@stanford.edu', 'owengrossman@stanford.edu', 'Owen Grossman', 0),
  ('angelzav@stanford.edu', 'cousinss@stanford.edu', 'Sam Cousins', 0),
  ('rhett@stanford.edu', 'jdmoyer@stanford.edu', 'Jackson Moyer', 0),
  ('rtellado@stanford.edu', 'zkhuang@stanford.edu', 'Zhikai Huang', 0),
  ('aaronh29@stanford.edu', 'cousinss@stanford.edu', 'Sam Cousins', 0),
  ('kushalp@stanford.edu', 'lcahilly@stanford.edu', 'Lundeen Cahilly', 0),
  ('nwillacy@stanford.edu', 'noemtz@stanford.edu', 'Noé Martínez', 0),
  ('josephz2@stanford.edu', 'cpierre@stanford.edu', 'Christian Pierre', 0),
  ('dwy@stanford.edu', 'owengrossman@stanford.edu', 'Owen Grossman', 0),
  ('marlonm@stanford.edu', 'mbdolan@stanford.edu', 'Michael Dolan', 0),
  ('amghazel@stanford.edu', 'petermcg@stanford.edu', 'Peter McGinnes', 0),
  ('jiayang5@stanford.edu', 'deanl@stanford.edu', 'Dean Liang', 0),
  ('gael15@stanford.edu', 'chrisvg@stanford.edu', 'Chris Vinasco-Gomez', 0),
  ('dtauhert@stanford.edu', 'deanl@stanford.edu', 'Dean Liang', 0),
  ('cwpalmer@stanford.edu', 'ayeung16@stanford.edu', 'Abraham Yeung', 0),
  ('avelasq@stanford.edu', 'noemtz@stanford.edu', 'Noé Martínez', 0),
  ('diegosel@stanford.edu', 'aledarb@stanford.edu', 'Alejandro Darbeloff', 0),
  ('mamayag@stanford.edu', 'gmurga@stanford.edu', 'Gerardo Murga', 0),
  ('domingo4@stanford.edu', 'jkarlson@stanford.edu', 'Jasper Karlson', 0),
  ('hoivan@stanford.edu', 'petermcg@stanford.edu', 'Peter McGinnes', 0),
  ('bauerlee@stanford.edu', 'aledarb@stanford.edu', 'Alejandro Darbeloff', 0),
  ('shmeyers@stanford.edu', 'jka@stanford.edu', 'Jai Agrawal', 0),
  ('cabenitz@stanford.edu', 'carlov@stanford.edu', 'Carlos Valencia Garcia', 0),
  ('trub@stanford.edu', 'ctenney@stanford.edu', 'Cooper Tenney', 0),
  ('romirj@stanford.edu', 'dsih@stanford.edu', 'Dylan Sih', 0),
  -- ── Ancestor → big links (older generations from the Figma "7-5" tree). ──
  -- Littles keyed by their synthetic @lineage.invalid email (created in
  -- roster-add-ancestors.sql — RUN THAT FIRST). big_email left NULL on purpose:
  -- big_membership_id is resolved by the name backfill after the insert. ~22 of
  -- these are geometric inferences off the edgeless render (see that file's note).
  ('braeden.milford@lineage.invalid', NULL, 'Gunner Dongieux', 0),
  ('carl.schoeller@lineage.invalid', NULL, 'Andy...', 0),
  ('elliot.dauber@lineage.invalid', NULL, 'Gunner Dongieux', 0),
  ('ethan.jones@lineage.invalid', NULL, 'Keyshawn King', 0),
  ('isaac.cheruiyot@lineage.invalid', NULL, 'Umar Nadeem', 0),
  ('jacob.faierman@lineage.invalid', NULL, 'Daniel Fishman', 0),
  ('josh.mitchell@lineage.invalid', NULL, 'Raphael Ruban', 0),
  ('justin.thach@lineage.invalid', NULL, 'Umar Nadeem', 0),
  ('kayson.hansen@lineage.invalid', NULL, 'Carson Poltorack', 0),
  ('marcelo.pena@lineage.invalid', NULL, 'Julio Contreras', 0),
  ('sahit.dendekuri@lineage.invalid', NULL, 'Aayush Agarwal', 0),
  ('alex.farman@lineage.invalid', NULL, 'Josh Mitchell', 0),
  ('andrej.elez@lineage.invalid', NULL, 'Eric Frankel', 0),
  ('bryan.khoo@lineage.invalid', NULL, 'Isaac Cheruiyot', 0),
  ('chehan.wijayaratne@lineage.invalid', NULL, 'Sahit Dendekuri', 0),
  ('ernesto.nam.song.woo@lineage.invalid', NULL, 'Marcelo Peña', 0),
  ('esteban.herrera.vendrell@lineage.invalid', NULL, 'Kevin Chen', 0),
  ('ethan.kato@lineage.invalid', NULL, 'Elliot Dauber', 0),
  ('gareth.cockroft@lineage.invalid', NULL, 'Grant Sheen', 0),
  ('john.bailey@lineage.invalid', NULL, 'Josh Mitchell', 0),
  ('john.kroeger@lineage.invalid', NULL, 'Alex Finan', 0),
  ('jonathan.coronado@lineage.invalid', NULL, 'Sahit Dendekuri', 0),
  ('kevin.yang@lineage.invalid', NULL, 'Elliot Dauber', 0),
  ('michael.chhay@lineage.invalid', NULL, 'Isaac Cheruiyot', 0),
  ('michael.zhu@lineage.invalid', NULL, 'Eric Frankel', 0),
  ('nathan.kuo@lineage.invalid', NULL, 'Eric Frankel', 0),
  ('nick.dietrich@lineage.invalid', NULL, 'Braeden Milford', 0),
  ('nick.reisner@lineage.invalid', NULL, 'Carl Schoeller', 0),
  ('nolan.mejia@lineage.invalid', NULL, 'Justin Thach', 0),
  ('peter.carpenter@lineage.invalid', NULL, 'Alex Finan', 0),
  ('sam.kwok@lineage.invalid', NULL, 'Justin Thach', 0),
  ('tee.monsureenusorn@lineage.invalid', NULL, 'Kayson Hansen', 0),
  ('tommy.adams@lineage.invalid', NULL, 'Ethan Jones', 0),
  ('trevor.jehl@lineage.invalid', NULL, 'Josh Mitchell', 0),
  ('zach.hoffman@lineage.invalid', NULL, 'Jacob Faierman', 0),
  ('adri.arquin@lineage.invalid', NULL, 'John Kroeger', 0),
  ('andrew.park@lineage.invalid', NULL, 'Nick Reisner', 0),
  ('anthony.chen@lineage.invalid', NULL, 'Max Reisner', 0),
  ('deveen.harsichandra@lineage.invalid', NULL, 'Tee Monsureenusorn', 0),
  ('ethan.bernheim@lineage.invalid', NULL, 'Zach Hoffman', 0),
  ('garin.gross@lineage.invalid', NULL, 'Michael Zhu', 0),
  ('lichu.acuna@lineage.invalid', NULL, 'Andrej Elez', 0),
  ('maxim.ivanov@lineage.invalid', NULL, 'Jonathan Coronado', 0),
  ('michael.brockman@lineage.invalid', NULL, 'Will Newton', 0),
  ('milo.golding@lineage.invalid', NULL, 'Tommy Adams', 0),
  ('nick.buckovich@lineage.invalid', NULL, 'John Belardi', 0),
  ('odin.farkas@lineage.invalid', NULL, 'Charlie Shors', 0),
  ('ping.tankongchamruskul@lineage.invalid', NULL, 'Kevin Yang', 0),
  ('theo.snoey@lineage.invalid', NULL, 'John Bailey', 0),
  ('titus.parker@lineage.invalid', NULL, 'Alex Farman', 0),
  ('benji.welner@lineage.invalid', NULL, 'Odin Farkas', 0),
  ('luke.smith@lineage.invalid', NULL, 'Tuvana Soronzonbold', 0);

insert into lineage (chapter_id, little_id, big_membership_id, big_name, ord)
select 'aaaaaaaa-0000-0000-0000-000000000001', lm.id, bm.id, s.big_name, s.ord
from lineage_stage s
join profiles    lp on lower(lp.email) = lower(s.little_email)
join memberships lm on lm.profile_id = lp.id and lm.chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001'
left join profiles    bp on s.big_email is not null and lower(bp.email) = lower(s.big_email)
left join memberships bm on bm.profile_id = bp.id and bm.chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001'
on conflict (little_id, big_name) do nothing;

-- 5. Backfill big_membership_id by name. The ancestor links above (and the ~30
--    pre-existing name-only bigs like Theo Snoey / Gareth Cockroft) were staged
--    with big_email NULL, so big_membership_id is unset. Now that every big is a
--    membership row (roster-add-ancestors.sql), link each unset row to its big by
--    matching the big's profile name. This populates member_standings.little_names
--    for the ancestors + old anchors; the app's tree already chained by the
--    big_name string, so this is about the derived little arrays, not the tree.
--    Rows already resolved via big_email (e.g. Cooper→Saul, Chris B→Carlos) are
--    skipped by the `is null` guard, so the two live short-name profiles are safe.
update lineage l
   set big_membership_id = bm.id
  from memberships bm
  join profiles bp on bp.id = bm.profile_id
 where l.chapter_id  = 'aaaaaaaa-0000-0000-0000-000000000001'
   and bm.chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and l.big_membership_id is null
   and bp.full_name = l.big_name;

commit;

-- Sanity checks (run after commit):
--   select count(*) from lineage;                       -- 158 links
--   -- unresolved bigs — expect 0 (the name backfill links every big to a
--   -- membership; a nonzero count means a big_name typo that didn't match a profile):
--   select count(*) from lineage where big_membership_id is null;   -- 0
--   -- true roots (no big at all — the "?" tops of the tree) — expect 24
--   -- (23 ancestor tops + Taden Horse, who has no recorded big):
--   select count(*) from memberships m
--    where m.chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001'
--      and not exists (select 1 from lineage l where l.little_id = m.id);
--   select full_name, big_name, little_names from member_standings
--     where big_name is not null order by full_name limit 20;
--   -- chain climbs to a root:
--   select full_name, big_name from member_standings
--     where full_name in ('Theo Snoey','John Bailey','Josh Mitchell','Raphael Ruban')
--     order by full_name;   -- Theo→John Bailey→Josh Mitchell→Raphael Ruban→(null)
