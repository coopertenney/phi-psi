-- Diagnostic: find "my" membership the way the app does (auth.users -> profiles
-- via auth_user_id -> memberships), and show its finances + any payments.
-- Read-only. Use the output to scope the real reset.

select
  au.email        as auth_email,
  p.email         as profile_email,
  p.full_name,
  mem.id          as membership_id,
  mf.charged_cents,
  mf.paid_cents,
  mf.balance_cents,
  mf.dues_state,
  (select count(*) from payments pay where pay.membership_id = mem.id) as payment_rows
from auth.users au
join profiles p       on p.auth_user_id = au.id
join memberships mem  on mem.profile_id = p.id
left join member_finances mf on mf.membership_id = mem.id
where au.email ilike '%ctenney%'
   or p.email  ilike '%ctenney%'
   or p.full_name ilike '%tenney%';
