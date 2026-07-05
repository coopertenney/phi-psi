-- ============================================================================
-- Phi Kappa Psi — roster update (2026-07-05)
-- Source: 'Phi Kappa Psi Actives 26_27.xlsx' (Spring 2026 tab), diffed against live DB.
-- Membership set unchanged (90 = 90, no adds/removes). This applies ONLY:
--   • 3 name fixes (drop trailing surnames to match the roster)
--   • 9 officer position titles (all already access_role='exec'; only `position` was null)
-- Roles are intentionally NOT touched: officers stay 'exec', admin unchanged.
-- Succession (President->admin) is deferred to the app's Appoint-exec screen.
-- Idempotent + atomic. Keyed by email so it's insensitive to profile ids.
-- ============================================================================

begin;

-- 1. Name fixes.
update profiles set full_name = 'Carlos Valencia' where lower(email) = 'carlov@stanford.edu';
update profiles set full_name = 'Sam Cousins' where lower(email) = 'cousinss@stanford.edu';
update profiles set full_name = 'Saul Hernandez' where lower(email) = 'saulh22@stanford.edu';

-- 2. Officer titles (position only; access_role left as-is).
update memberships set position = 'President'
  where profile_id = (select id from profiles where lower(email) = 'modesitt@stanford.edu');
update memberships set position = 'Vice President'
  where profile_id = (select id from profiles where lower(email) = 'aleick@stanford.edu');
update memberships set position = 'Treasurer'
  where profile_id = (select id from profiles where lower(email) = 'mbdolan@stanford.edu');
update memberships set position = 'Recording Secretary'
  where profile_id = (select id from profiles where lower(email) = 'deanl@stanford.edu');
update memberships set position = 'Corresponding Secretary'
  where profile_id = (select id from profiles where lower(email) = 'viveky@stanford.edu');
update memberships set position = 'Messenger'
  where profile_id = (select id from profiles where lower(email) = 'wohlberg@stanford.edu');
update memberships set position = 'Sergeant at Arms'
  where profile_id = (select id from profiles where lower(email) = 'owengrossman@stanford.edu');
update memberships set position = 'Chaplain'
  where profile_id = (select id from profiles where lower(email) = 'shawng28@stanford.edu');
update memberships set position = 'Historian'
  where profile_id = (select id from profiles where lower(email) = 'petermcg@stanford.edu');

commit;

-- Verify: expect the 3 corrected names + 9 titled officers below.
select p.full_name, p.email, m.position, m.access_role
from memberships m join profiles p on p.id = m.profile_id
where m.position is not null
   or lower(p.email) in ('carlov@stanford.edu','cousinss@stanford.edu','saulh22@stanford.edu')
order by m.position nulls last, p.full_name;
