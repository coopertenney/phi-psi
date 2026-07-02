-- ============================================================================
-- Phi Kappa Psi — load REAL roster (Spring 2026 actives) + remove dummy members
-- Generated from: members/Phi Kappa Psi Actives 26_27 - Spring 2026.csv
-- Run ONCE in the Supabase SQL editor. Wrapped in a transaction — all or nothing.
--
-- Roster: 90 active members
--   admin  = 1  (Cooper Tenney — change below if the President should be admin)
--   exec   = 9   (the 9 tagged "Exec" in the sheet)
--   member = 80
-- No dues/points/attendance yet — those tables stay empty until you add real data,
-- so the app will show $0 collected / 0 points for now. That's expected.
--
-- ⚠️  RE-RUNNING THIS FILE WIPES AND RELOADS ALL 90 MEMBERS. If you later add real
--     dues/points/attendance, those cascade-delete on a re-run. Only re-run to reset.
-- ============================================================================

begin;

-- 1. Remove the 12 dummy members. ON DELETE CASCADE takes their dues, payments,
--    points, attendance, and RSVPs with them; dummy announcement authors go null.
delete from memberships where chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from profiles p
  where not exists (select 1 from memberships m where m.profile_id = p.id);

-- 2. Stage the real roster.
create temp table roster (full_name text, email text, access_role access_role, class_year int)
  on commit drop;
insert into roster (full_name, email, access_role, class_year) values
  ('Joshua Koch', 'jmkoch@stanford.edu', 'member'::access_role, 2027),
  ('Saul Hernandez Vigil', 'saulh22@stanford.edu', 'member'::access_role, 2027),
  ('Lundeen Cahilly', 'lcahilly@stanford.edu', 'member'::access_role, 2028),
  ('Zachary Ewing', 'zpewing@stanford.edu', 'member'::access_role, 2027),
  ('Samuel Cousins', 'cousinss@stanford.edu', 'member'::access_role, 2028),
  ('Andrew Leick', 'aleick@stanford.edu', 'exec'::access_role, 2028),
  ('Benji Warburton', 'benjiw@stanford.edu', 'member'::access_role, 2028),
  ('Cooper Tenney', 'ctenney@stanford.edu', 'admin'::access_role, 2028),
  ('Eddy Duran', 'endur@stanford.edu', 'member'::access_role, 2027),
  ('Efrain Angon-Cruz', 'efrainac@stanford.edu', 'member'::access_role, 2027),
  ('Tuvana Soronzonbold', 'tuvana@stanford.edu', 'member'::access_role, 2027),
  ('Mateo Solis', 'mtsolis@stanford.edu', 'member'::access_role, 2027),
  ('Jose Berdeja', 'jcberdej@stanford.edu', 'member'::access_role, 2027),
  ('Vivek Yarlagedda', 'viveky@stanford.edu', 'exec'::access_role, 2028),
  ('Panos Papanastasiou', 'panapap@stanford.edu', 'member'::access_role, 2027),
  ('Taden Horse', 'tadenh@stanford.edu', 'member'::access_role, 2027),
  ('Jackson Moyer', 'jdmoyer@stanford.edu', 'member'::access_role, 2028),
  ('Alex Wohlberg', 'wohlberg@stanford.edu', 'exec'::access_role, 2028),
  ('Brooks Modesitt', 'modesitt@stanford.edu', 'exec'::access_role, 2028),
  ('Jasper Karlson', 'jkarlson@stanford.edu', 'member'::access_role, 2028),
  ('Owen Grossman', 'owengrossman@stanford.edu', 'exec'::access_role, 2028),
  ('Connor Lee', 'connor1@stanford.edu', 'member'::access_role, 2027),
  ('Ben McAulay', 'ooo@stanford.edu', 'member'::access_role, 2027),
  ('Chris Vinasco-Gomez', 'chrisvg@stanford.edu', 'member'::access_role, 2028),
  ('Jonas Pao', 'jonaspao@stanford.edu', 'member'::access_role, 2027),
  ('Shawn Gregory', 'shawng28@stanford.edu', 'exec'::access_role, 2028),
  ('Zack Ryan', 'zackryan@stanford.edu', 'member'::access_role, 2027),
  ('Gerardo Murga', 'gmurga@stanford.edu', 'member'::access_role, 2028),
  ('Peter McGinnes', 'petermcg@stanford.edu', 'exec'::access_role, 2028),
  ('Dean Liang', 'deanl@stanford.edu', 'exec'::access_role, 2028),
  ('Griffin Lee', 'griffin2@stanford.edu', 'member'::access_role, 2027),
  ('Alejandro Darbeloff', 'aledarb@stanford.edu', 'member'::access_role, 2028),
  ('Noé Martínez', 'noemtz@stanford.edu', 'member'::access_role, 2028),
  ('Dylan Sih', 'dsih@stanford.edu', 'member'::access_role, 2028),
  ('Thijs Simonian', 'thijs@stanford.edu', 'member'::access_role, 2028),
  ('Abraham Yeung', 'ayeung16@stanford.edu', 'member'::access_role, 2028),
  ('Carlos Valencia Garcia', 'carlov@stanford.edu', 'member'::access_role, 2028),
  ('Michael Dolan', 'mbdolan@stanford.edu', 'exec'::access_role, 2028),
  ('Josh Barsoian', 'joshbars@stanford.edu', 'member'::access_role, 2028),
  ('Carter Dessommes', 'carterd1@stanford.edu', 'member'::access_role, 2027),
  ('Jai Agrawal', 'jka@stanford.edu', 'member'::access_role, 2028),
  ('Christian Pierre', 'cpierre@stanford.edu', 'member'::access_role, 2028),
  ('Dilan Gohill', 'dgohill@stanford.edu', 'member'::access_role, 2027),
  ('Jonathan Tubb', 'jmtubb1@stanford.edu', 'member'::access_role, 2027),
  ('Zhikai Huang', 'zkhuang@stanford.edu', 'member'::access_role, 2028),
  ('George Porteous', 'gport@stanford.edu', 'member'::access_role, 2027),
  ('Bradley Bush', 'bkbush@stanford.edu', 'member'::access_role, 2027),
  ('Henry Boeschen', 'hdboesch@stanford.edu', 'member'::access_role, 2027),
  ('Aaron Tiao', 'atiao@stanford.edu', 'member'::access_role, 2027),
  ('Benjamin Chen', 'benbchen@stanford.edu', 'member'::access_role, 2027),
  ('Sam Jonker', 'sjonker@stanford.edu', 'member'::access_role, 2027),
  ('Zaydan Amanullah', 'zaydanka@stanford.edu', 'member'::access_role, 2027),
  ('Yannick Mofor', 'yannickm@stanford.edu', 'member'::access_role, 2027),
  ('Kristopher Luo', 'krisluo@stanford.edu', 'member'::access_role, 2027),
  ('Ben Vu', 'benvu@stanford.edu', 'member'::access_role, 2028),
  ('Bison McCotter-Hulett', 'bisonmh@stanford.edu', 'member'::access_role, 2029),
  ('Burkson Montague-Alamin', 'burkema@stanford.edu', 'member'::access_role, 2029),
  ('Carson Packard', 'cwason06@stanford.edu', 'member'::access_role, 2029),
  ('Connor Engstrom', 'connorfe@stanford.edu', 'member'::access_role, 2029),
  ('Benjamin Schindler', 'bschind@stanford.edu', 'member'::access_role, 2029),
  ('Sanjay De Silva', 'sanjayde@stanford.edu', 'member'::access_role, 2029),
  ('William Maher', 'wmaher@stanford.edu', 'member'::access_role, 2029),
  ('Shrish Premkrishna', 'shrishp@stanford.edu', 'member'::access_role, 2029),
  ('Charles Simonian', 'csimonia@stanford.edu', 'member'::access_role, 2029),
  ('Tej Kosaraju', 'tejk@stanford.edu', 'member'::access_role, 2029),
  ('Arun Tamura', 'atamura@stanford.edu', 'member'::access_role, 2029),
  ('Angel Zavala', 'angelzav@stanford.edu', 'member'::access_role, 2029),
  ('Rhett Hounsell', 'rhett@stanford.edu', 'member'::access_role, 2029),
  ('Ryan Tellado', 'rtellado@stanford.edu', 'member'::access_role, 2029),
  ('Aaron Henschel', 'aaronh29@stanford.edu', 'member'::access_role, 2029),
  ('Kushal Patel', 'kushalp@stanford.edu', 'member'::access_role, 2029),
  ('Nigel Willacy', 'nwillacy@stanford.edu', 'member'::access_role, 2029),
  ('Joseph Zhang', 'josephz2@stanford.edu', 'member'::access_role, 2029),
  ('Jan Dwayne Cacnio', 'dwy@stanford.edu', 'member'::access_role, 2029),
  ('Marlon Moenius', 'marlonm@stanford.edu', 'member'::access_role, 2029),
  ('August Hazel', 'amghazel@stanford.edu', 'member'::access_role, 2029),
  ('Jason Wang', 'jiayang5@stanford.edu', 'member'::access_role, 2029),
  ('Gael Martinez', 'gael15@stanford.edu', 'member'::access_role, 2029),
  ('Daniel Tauhert', 'dtauhert@stanford.edu', 'member'::access_role, 2029),
  ('Clifford Palmer', 'cwpalmer@stanford.edu', 'member'::access_role, 2029),
  ('Angel Velasquez', 'avelasq@stanford.edu', 'member'::access_role, 2029),
  ('Diego Seligman-Tovar', 'diegosel@stanford.edu', 'member'::access_role, 2029),
  ('Martin Amaya', 'mamayag@stanford.edu', 'member'::access_role, 2028),
  ('Dylan Dominguez', 'domingo4@stanford.edu', 'member'::access_role, 2029),
  ('Ivan Ho', 'hoivan@stanford.edu', 'member'::access_role, 2029),
  ('Bauer Lee', 'bauerlee@stanford.edu', 'member'::access_role, 2029),
  ('Simon Meyers', 'shmeyers@stanford.edu', 'member'::access_role, 2029),
  ('Chris Benitez', 'cabenitz@stanford.edu', 'member'::access_role, 2029),
  ('Tyler Rubenstein', 'trub@stanford.edu', 'member'::access_role, 2029),
  ('Romir Jain', 'romirj@stanford.edu', 'member'::access_role, 2029);

-- 3. Insert profiles (identity), then memberships (chapter standing) by email.
insert into profiles (full_name, email)
  select full_name, email from roster
  on conflict (email) do nothing;

insert into memberships (chapter_id, profile_id, access_role, position, status, class_year, committee)
  select 'aaaaaaaa-0000-0000-0000-000000000001', p.id, r.access_role, null, 'active', r.class_year, null
  from roster r join profiles p on p.email = r.email;

commit;

-- 4. Verify — expect 90 total, split 1/9/80.
select access_role, count(*) from memberships
  where chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001' group by access_role order by access_role;
select count(*) as total_members from memberships where chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001';
