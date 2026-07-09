// Server-only: the single place a Stripe Checkout Session becomes a `payments`
// row. Shared by the webhook (async/authoritative, and the only path for ACH)
// and the success-return verifier (synchronous, so localhost demos and the
// happy path don't have to wait on a webhook that may never arrive).
//
// Idempotent by stripe_payment_intent_id: whichever path lands first writes the
// row; the other is a no-op. `payments` has no unique constraint on that column,
// so the guard is an explicit existence check.
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

  await sb.from('payments').insert({
    membership_id: membershipId,
    amount_cents: amountCents,
    status,
    stripe_payment_intent_id: paymentIntentId,
    paid_at: status === 'succeeded' ? new Date().toISOString() : null,
  });
}
