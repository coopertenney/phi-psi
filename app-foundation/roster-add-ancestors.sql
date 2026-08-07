-- ============================================================================
-- Phi Kappa Psi — add 75 lineage ancestors (older generations) to the roster
-- Run ONCE in the Supabase SQL editor, THEN RE-RUN app-foundation/lineage-live.sql.
--
-- Why: the lineage tree stops at the ~30 name-only "bigs" the active roster
-- references (Theo Snoey, Gareth Cockroft, …). The chapter's Figma lineage tree
-- (the "7-5" export) documents the generations ABOVE them — up through the
-- oldest known alumni — plus a few side branches. Because none are membership
-- rows, member_standings emits no row for them, so the app's name-based tree
-- can't chain past them (a name-only big always renders as a root). This adds
-- them as ALUMNI (status 'inactive') so the tree grows upward to match the
-- documented forest.
--
-- This file is ADDITIVE and idempotent — no delete/cascade:
--   1. Inserts 75 ancestor profiles. They have no real email, so we key them on
--      a synthetic, RFC-reserved `@lineage.invalid` address (never deliverable,
--      never a login — profiles are decoupled from auth). This same email is the
--      join key in lineage-live.sql, so the two files MUST agree exactly.
--   2. Inserts them as memberships with status 'inactive' → excluded from the
--      members list + every stat card (getMembers / chapter_stats already filter
--      inactive), shown only in the Lineage tab (getLineageRoster includes them).
--   3. class_year is the generation the Figma tree placed them in (band + 2022):
--      alumni years 2023–2026 for the older bands; a couple sit lower.
--
-- No chapter_stats change needed — roster-add-alumni.sql already rewrote it to
-- filter status <> 'inactive', so these new inactive rows never touch any stat.
--
-- ⚠️  AFTER running this, RE-RUN app-foundation/lineage-live.sql. That file now
--     stages these ancestors' own big→little links (keyed by the same synthetic
--     emails) and backfills big_membership_id by name — so the whole forest
--     connects: the old name-only anchors link up to their bigs, and the new
--     ancestors chain all the way to the oldest known generation.
--
-- Provenance note: ~22 of the ancestor→big links are geometric inferences read
-- off an edgeless render (fan-out / offset cases); the rest read cleanly off the
-- Figma columns. Every *current* brother's big was already correct and is
-- unchanged. See the "verify the connections" artifact + comments in lineage-live.sql.
-- ============================================================================

begin;

-- 1. Stage the 75 ancestors (full_name, synthetic email, class_year). ----------
create temp table add_ancestors (full_name text, email text, class_year int) on commit drop;
insert into add_ancestors (full_name, email, class_year) values
  ('Aayush Agarwal', 'aayush.agarwal@lineage.invalid', 2023),
  ('Andy...', 'andy@lineage.invalid', 2023),
  ('Carson Poltorack', 'carson.poltorack@lineage.invalid', 2023),
  ('Daniel Fishman', 'daniel.fishman@lineage.invalid', 2023),
  ('Gunner Dongieux', 'gunner.dongieux@lineage.invalid', 2023),
  ('Julio Contreras', 'julio.contreras@lineage.invalid', 2023),
  ('Keyshawn King', 'keyshawn.king@lineage.invalid', 2023),
  ('Raphael Ruban', 'raphael.ruban@lineage.invalid', 2023),
  ('Umar Nadeem', 'umar.nadeem@lineage.invalid', 2023),
  ('Alex Finan', 'alex.finan@lineage.invalid', 2024),
  ('Braeden Milford', 'braeden.milford@lineage.invalid', 2024),
  ('Carl Schoeller', 'carl.schoeller@lineage.invalid', 2024),
  ('Elliot Dauber', 'elliot.dauber@lineage.invalid', 2024),
  ('Eric Frankel', 'eric.frankel@lineage.invalid', 2024),
  ('Ethan Jones', 'ethan.jones@lineage.invalid', 2024),
  ('Grant Sheen', 'grant.sheen@lineage.invalid', 2024),
  ('Isaac Cheruiyot', 'isaac.cheruiyot@lineage.invalid', 2024),
  ('Jacob Faierman', 'jacob.faierman@lineage.invalid', 2024),
  ('John Belardi', 'john.belardi@lineage.invalid', 2024),
  ('Josh Mitchell', 'josh.mitchell@lineage.invalid', 2024),
  ('Justin Thach', 'justin.thach@lineage.invalid', 2024),
  ('Kayson Hansen', 'kayson.hansen@lineage.invalid', 2024),
  ('Kevin Chen', 'kevin.chen@lineage.invalid', 2024),
  ('Marcelo Peña', 'marcelo.pena@lineage.invalid', 2024),
  ('Sahit Dendekuri', 'sahit.dendekuri@lineage.invalid', 2024),
  ('Alex Farman', 'alex.farman@lineage.invalid', 2025),
  ('Andrej Elez', 'andrej.elez@lineage.invalid', 2025),
  ('Bryan Khoo', 'bryan.khoo@lineage.invalid', 2025),
  ('Charlie Shors', 'charlie.shors@lineage.invalid', 2025),
  ('Chehan Wijayaratne', 'chehan.wijayaratne@lineage.invalid', 2025),
  ('Dhruv Sumathi', 'dhruv.sumathi@lineage.invalid', 2025),
  ('Ernesto Nam Song Woo', 'ernesto.nam.song.woo@lineage.invalid', 2025),
  ('Esteban Herrera-Vendrell', 'esteban.herrera.vendrell@lineage.invalid', 2025),
  ('Ethan Kato', 'ethan.kato@lineage.invalid', 2025),
  ('Ethan Tiao', 'ethan.tiao@lineage.invalid', 2025),
  ('Ezra Kohrman', 'ezra.kohrman@lineage.invalid', 2025),
  ('Gareth Cockroft', 'gareth.cockroft@lineage.invalid', 2025),
  ('John Bailey', 'john.bailey@lineage.invalid', 2025),
  ('John Kroeger', 'john.kroeger@lineage.invalid', 2025),
  ('Jonathan Coronado', 'jonathan.coronado@lineage.invalid', 2025),
  ('Kevin Yang', 'kevin.yang@lineage.invalid', 2025),
  ('Max Reisner', 'max.reisner@lineage.invalid', 2025),
  ('Michael Chhay', 'michael.chhay@lineage.invalid', 2025),
  ('Michael Zhu', 'michael.zhu@lineage.invalid', 2025),
  ('Nathan Kuo', 'nathan.kuo@lineage.invalid', 2025),
  ('Nick Dietrich', 'nick.dietrich@lineage.invalid', 2025),
  ('Nick Reisner', 'nick.reisner@lineage.invalid', 2025),
  ('Nolan Mejia', 'nolan.mejia@lineage.invalid', 2025),
  ('Peter Carpenter', 'peter.carpenter@lineage.invalid', 2025),
  ('Sam Kwok', 'sam.kwok@lineage.invalid', 2025),
  ('Tee Monsureenusorn', 'tee.monsureenusorn@lineage.invalid', 2025),
  ('Tommy Adams', 'tommy.adams@lineage.invalid', 2025),
  ('Trevor Jehl', 'trevor.jehl@lineage.invalid', 2025),
  ('Will Newton', 'will.newton@lineage.invalid', 2025),
  ('Yahir Ruiz', 'yahir.ruiz@lineage.invalid', 2025),
  ('Zach Hoffman', 'zach.hoffman@lineage.invalid', 2025),
  ('Adri Arquin', 'adri.arquin@lineage.invalid', 2026),
  ('Andrew Park', 'andrew.park@lineage.invalid', 2026),
  ('Anthony Chen', 'anthony.chen@lineage.invalid', 2026),
  ('Deveen Harsichandra', 'deveen.harsichandra@lineage.invalid', 2026),
  ('Ethan Bernheim', 'ethan.bernheim@lineage.invalid', 2026),
  ('Ethan Kirgan', 'ethan.kirgan@lineage.invalid', 2026),
  ('Garin Gross', 'garin.gross@lineage.invalid', 2026),
  ('Lichu Acuna', 'lichu.acuna@lineage.invalid', 2026),
  ('Maxim Ivanov', 'maxim.ivanov@lineage.invalid', 2026),
  ('Michael Brockman', 'michael.brockman@lineage.invalid', 2026),
  ('Milo Golding', 'milo.golding@lineage.invalid', 2026),
  ('Nick Buckovich', 'nick.buckovich@lineage.invalid', 2026),
  ('Odin Farkas', 'odin.farkas@lineage.invalid', 2026),
  ('Ping Tankongchamruskul', 'ping.tankongchamruskul@lineage.invalid', 2026),
  ('Sidd Wali', 'sidd.wali@lineage.invalid', 2026),
  ('Theo Snoey', 'theo.snoey@lineage.invalid', 2026),
  ('Titus Parker', 'titus.parker@lineage.invalid', 2026),
  ('Benji Welner', 'benji.welner@lineage.invalid', 2027),
  ('Luke Smith', 'luke.smith@lineage.invalid', 2029);

-- 2. Profiles then memberships — idempotent (safe to re-run). ------------------
insert into profiles (full_name, email)
  select full_name, email from add_ancestors
  on conflict (email) do nothing;

insert into memberships (chapter_id, profile_id, access_role, position, status, class_year, committee)
  select 'aaaaaaaa-0000-0000-0000-000000000001', p.id, 'member'::access_role, null, 'inactive'::member_status, a.class_year, null
  from add_ancestors a
  join profiles p on p.email = a.email
  where not exists (
    select 1 from memberships m
     where m.profile_id = p.id
       and m.chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  );

commit;

-- 3. Verify — expect 180 memberships after this (105 + 75). --------------------
select count(*) as total_members from memberships
  where chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001';            -- 180
select status, count(*) from memberships
  where chapter_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  group by status order by status;                                      -- active 91 / inactive 89
-- Then RE-RUN lineage-live.sql and check the tree connects, e.g.:
--   select full_name, big_name from member_standings
--     where full_name in ('Theo Snoey','John Bailey','Josh Mitchell','Raphael Ruban')
--     order by full_name;   -- Theo→John Bailey→Josh Mitchell→Raphael Ruban→(root)
