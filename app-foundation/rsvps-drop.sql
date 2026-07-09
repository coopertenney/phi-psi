-- ============================================================================
-- Phi Kappa Psi — remove in-app RSVPs (now handled entirely in Partiful)
-- Run ONCE in the Supabase SQL editor when ready. Safe to re-run (idempotent).
--
-- RSVPs moved to Partiful: each social carries an optional partiful_url
-- (events-partiful.sql) and members RSVP on the Partiful invite. The app no
-- longer reads or writes any per-member RSVP, so the rsvps table + its enum are
-- dead. This drops them. Events, meetings, attendance, and the partiful_url
-- column are untouched.
--
-- NOTE: dropping the table permanently deletes existing RSVP rows. That's the
-- intent — they're no longer surfaced anywhere in the app.
-- ============================================================================

begin;

-- The rsvps RLS policies go away with the table, but drop them explicitly first
-- so a partial prior state doesn't error.
drop policy if exists rsvps_read on rsvps;
drop policy if exists rsvps_mine on rsvps;

drop table if exists rsvps;

-- The enum is only used by rsvps; drop it too. (No-op if already gone.)
drop type if exists rsvp_status;

commit;
