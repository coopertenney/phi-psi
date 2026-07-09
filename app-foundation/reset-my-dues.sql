-- Reset "my" dues so I can pay the fake dues again.
--
-- balance_cents = sum(dues_charges) - sum(succeeded payments)  (member_finances view).
-- "Dues paid in full" = a succeeded payment row zeroes out the balance.
-- Deleting that payment restores the balance to the charged amount, so the
-- Pay button reappears in the Finances tab.
--
-- Scoped to a single member by login email. Change the email if needed.

with me as (
  select mem.id as membership_id
  from memberships mem
  join profiles p on p.id = mem.profile_id
  where p.email = 'ctenney@paretoagent.ai'
)
delete from payments
where membership_id in (select membership_id from me);

-- Verify: should now show balance_cents > 0 and dues_state = 'due'.
select mf.membership_id, p.full_name, mf.charged_cents, mf.paid_cents, mf.balance_cents, mf.dues_state
from member_finances mf
join memberships mem on mem.id = mf.membership_id
join profiles p on p.id = mem.profile_id
where p.email = 'ctenney@paretoagent.ai';
