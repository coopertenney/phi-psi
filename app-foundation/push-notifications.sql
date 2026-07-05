-- ============================================================================
-- Phi Kappa Psi — Web Push subscriptions
-- Run ONCE in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- Stores one row per browser/device a member has enabled notifications on
-- (a person can have several — laptop + phone). The row holds the W3C Push
-- subscription: the push service `endpoint` (unique) plus the `p256dh`/`auth`
-- keys the server needs to encrypt a message to that device. NO message content
-- ever lives here.
--
-- Ownership is per-profile (the person), resolved through profiles.auth_user_id
-- like every other self-service policy in this schema (cf. points-approval.sql).
-- Sends go out from the SERVICE-ROLE client (lib/supabase/admin.ts via
-- lib/push.ts), which bypasses RLS — the same pattern the Stripe webhook uses.
-- ============================================================================

begin;

create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_profile_idx
  on push_subscriptions (profile_id);

alter table push_subscriptions enable row level security;

-- A member owns only their own device subscriptions. The client upserts on
-- (endpoint), so both INSERT and UPDATE are needed; DELETE lets them turn
-- notifications off from that device. No exec/read-all policy — nobody needs to
-- see anyone else's endpoints, and the server sends as service_role anyway.
drop policy if exists push_sub_select on push_subscriptions;
create policy push_sub_select on push_subscriptions for select
  using (
    profile_id in (select id from profiles where auth_user_id = auth.uid())
  );

drop policy if exists push_sub_insert on push_subscriptions;
create policy push_sub_insert on push_subscriptions for insert
  with check (
    profile_id in (select id from profiles where auth_user_id = auth.uid())
  );

drop policy if exists push_sub_update on push_subscriptions;
create policy push_sub_update on push_subscriptions for update
  using (
    profile_id in (select id from profiles where auth_user_id = auth.uid())
  )
  with check (
    profile_id in (select id from profiles where auth_user_id = auth.uid())
  );

drop policy if exists push_sub_delete on push_subscriptions;
create policy push_sub_delete on push_subscriptions for delete
  using (
    profile_id in (select id from profiles where auth_user_id = auth.uid())
  );

-- Table-level grants. RLS still gates the rows; this just opens the table to the
-- roles at the privilege level (the schema reset stripped defaults — see
-- grants-service-role.sql). service_role needs it to send; authenticated to
-- self-manage.
grant select, insert, update, delete on push_subscriptions to authenticated;
grant select, insert, update, delete on push_subscriptions to service_role;

commit;

notify pgrst, 'reload schema';

-- Verify: table exists with RLS on and four self-service policies.
select
  (select count(*) from pg_policies where tablename = 'push_subscriptions') as policies,
  (select relrowsecurity from pg_class where relname = 'push_subscriptions')  as rls_enabled;
