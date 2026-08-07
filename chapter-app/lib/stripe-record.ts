// Server-only: the single place a Stripe Checkout Session becomes a `payments`
// row. Shared by the webhook (async/authoritative, and the only path for ACH)
// and the success-return verifier (synchronous, so localhost demos and the
// happy path don't have to wait on a webhook that may never arrive).
//
// Idempotent by stripe_payment_intent_id: whichever path lands first writes the
// row; the other is a no-op. Two layers of guard, because THREE callers race for
// the same intent id (webhook vs. success-return verifier; webhook vs. re-delivered
// webhook — Stripe delivers at least once; a re-loaded ?paid=1 return URL):
//   1. a fast-path existence check (skips the insert in the common, non-racing case);
//   2. a UNIQUE index on payments(stripe_payment_intent_id) — the real guard, since
//      the check-then-insert in (1) has a race window two concurrent calls both pass.
// The DB rejects the loser's insert with a unique violation (23505), which we
// swallow as a successful no-op. See app-foundation/payments-idempotency.sql.
// This degrades gracefully if that migration hasn't run yet: without the index,
// the 23505 branch simply never fires and only the check in (1) applies (as before).
import type Stripe from 'stripe';
import { getAdminSupabase } from '@/lib/supabase/admin';

export async function recordCheckoutPayment(
  session: Stripe.Checkout.Session,
  status: 'succeeded' | 'failed',
): Promise<void> {
  const membershipId = session.metadata?.membership_id;
  if (!membershipId) return;

  const sb = getAdminSupabase();
  const amountCents = session.amount_total ?? 0;
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.id;

  const { data: existing } = await sb
    .from('payments').select('id').eq('stripe_payment_intent_id', paymentIntentId).maybeSingle();
  if (existing) return;

  const { error } = await sb.from('payments').insert({
    membership_id: membershipId,
    amount_cents: amountCents,
    status,
    stripe_payment_intent_id: paymentIntentId,
    paid_at: status === 'succeeded' ? new Date().toISOString() : null,
  });

  // A concurrent caller beat us to this exact intent id: the unique index
  // rejected our insert (Postgres 23505). That's the idempotency guarantee
  // working — the payment is already recorded, so treat it as a no-op. Any
  // other error is real and must propagate so the webhook returns non-2xx and
  // Stripe retries (the success-return path swallows it and just returns false).
  if (error && error.code !== '23505') throw error;
}
