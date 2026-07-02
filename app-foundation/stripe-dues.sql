-- ============================================================================
-- Phi Kappa Psi — Stripe dues payments
-- Run ONCE in the Supabase SQL editor, after schema.sql (and seed.sql/roster).
--   1. adds chapters.dues_payments_enabled — the Finance Officer's on/off
--      switch for online payments (the FO's Stripe account often isn't ready
--      right when the school year starts, since the officer/account changes
--      most years — this lets them flip payments on only once it's linked).
--   2. turns on Row-Level Security for chapters (it had none before — anyone
--      with the anon key could otherwise read/write every column).
-- After this: any chapter member can read the flag (so Finances can show/hide
-- the Pay button); only exec/admin can flip it.
-- ============================================================================

begin;

alter table chapters
  add column if not exists dues_payments_enabled boolean not null default false;

alter table chapters enable row level security;

drop policy if exists chapters_read  on chapters;
drop policy if exists chapters_write on chapters;

create policy chapters_read on chapters
  for select using (is_chapter_member(id));

-- Exec/admin only — this is the Treasurer/FO's switch. Restricting the SET
-- clause isn't practical in RLS, but the app only ever writes
-- dues_payments_enabled through this path, and USING+WITH CHECK both gate on
-- exec so a non-exec member's write attempt is rejected outright.
create policy chapters_write on chapters
  for update using (is_chapter_exec(id)) with check (is_chapter_exec(id));

commit;

-- Verify: flip it on for the seed chapter once Stripe is ready to test with.
-- update chapters set dues_payments_enabled = true
--   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
