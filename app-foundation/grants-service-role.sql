-- ============================================================================
-- Phi Kappa Psi — restore grants for the service_role
-- Run ONCE in the Supabase SQL editor.
--
-- WHY: the earlier `drop schema public cascade` reset stripped table privileges
-- from EVERY role. grants-and-link.sql restored them for `authenticated` only.
-- The Stripe webhook (app/api/stripe/webhook/route.ts) writes the `payments`
-- row through the SERVICE-ROLE client (lib/supabase/admin.ts) — it has no
-- logged-in session, so it relies on the service_role's own grants + its
-- built-in RLS bypass. Without this, the webhook's insert fails with 42501
-- "permission denied for table payments", so a checkout succeeds at Stripe but
-- the payment is never recorded and the member's balance never drops.
--
-- service_role already bypasses RLS; this only re-opens the tables to it at the
-- grant level. Idempotent — safe to re-run.
-- ============================================================================

grant usage on schema public to service_role;

grant select, insert, update, delete on all tables    in schema public to service_role;
grant usage, select                on all sequences in schema public to service_role;
grant execute                      on all functions in schema public to service_role;

-- Future objects inherit the same, so new tables never need a repeat.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;

notify pgrst, 'reload schema';

-- Verify: service_role should now have DML on payments (the webhook's target).
select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'payments' and grantee = 'service_role'
group by grantee;
