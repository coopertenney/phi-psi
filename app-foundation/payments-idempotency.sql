-- ============================================================================
-- Phi Kappa Psi — make Stripe payment recording idempotent at the DB layer
-- Run ONCE in the Supabase SQL editor, after schema.sql + stripe-dues.sql.
--
-- WHY: a Stripe Checkout can be recorded twice for the SAME payment because
-- three code paths all call recordCheckoutPayment() (lib/stripe-record.ts) and
-- their app-level "does a row already exist?" check is a check-then-insert with
-- a race window:
--   1. the webhook (checkout.session.completed) vs. the success-return verifier
--      (/finances?paid=1&session_id=…), which fire ~simultaneously;
--   2. webhook vs. webhook — Stripe delivers events AT LEAST ONCE and re-delivers;
--   3. the browser re-loading the ?paid=1 return URL (back button, PWA refocus).
-- Two calls can both read "no existing row" and both INSERT → a doubled payment,
-- which the member_finances view reads as paid=2× → balance goes negative.
--
-- FIX: a UNIQUE index on stripe_payment_intent_id so the DB rejects the second
-- insert regardless of timing. NULLs are distinct in Postgres, so the seed
-- payments (stripe_payment_intent_id IS NULL) are unaffected — any number of
-- them coexist. A plain (not partial) index so `on conflict` inference is clean.
-- ============================================================================

begin;

-- 1. Safety check: the unique index creation below FAILS if a duplicate already
--    slipped in before this migration. Surface any dupes so they can be cleaned
--    up first. (Expected: zero rows — dues_payments_enabled defaults off.)
--    If this returns rows, delete the extra payment(s) per intent id before
--    re-running, keeping the earliest by created_at.
do $$
declare
  dup_count integer;
begin
  select count(*) into dup_count from (
    select stripe_payment_intent_id
    from payments
    where stripe_payment_intent_id is not null
    group by stripe_payment_intent_id
    having count(*) > 1
  ) d;
  if dup_count > 0 then
    raise exception
      'Found % Stripe payment-intent id(s) with duplicate payment rows. Dedupe them before adding the unique index.', dup_count;
  end if;
end $$;

-- 2. The guard. `if not exists` so re-running is safe.
create unique index if not exists payments_stripe_payment_intent_id_key
  on payments (stripe_payment_intent_id);

commit;

-- Verify: the index exists and no duplicate intent ids remain.
-- select indexname from pg_indexes where tablename = 'payments';
-- select stripe_payment_intent_id, count(*)
--   from payments where stripe_payment_intent_id is not null
--   group by 1 having count(*) > 1;   -- expect zero rows
