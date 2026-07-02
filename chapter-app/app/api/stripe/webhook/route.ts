// Stripe calls this after a Checkout Session finishes. It's the ONLY place
// that writes to the `payments` table for real charges — never trust the
// client to report its own payment succeeded. Verifies the signature, then
// writes membership_id + amount + status + stripe_payment_intent_id (never
// card data — schema.sql's payments table doesn't have a column for it).
//
// Card payments confirm synchronously (checkout.session.completed, paid).
// US bank debit (ACH) confirms 3-5 days later via the async_payment_* events,
// so both paths are handled.
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { getAdminSupabase, isAdminSupabaseConfigured } from '@/lib/supabase/admin';

export const runtime = 'nodejs'; // needs the raw body; edge runtime can't give us that here

async function recordPayment(session: Stripe.Checkout.Session, status: 'succeeded' | 'failed') {
  const membershipId = session.metadata?.membership_id;
  if (!membershipId) return;

  const sb = getAdminSupabase();
  const amountCents = session.amount_total ?? 0;
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.id;

  // Idempotent: Stripe retries webhooks, so skip if we've already recorded
  // this payment intent (unique-ish key we control, since payments has no
  // unique constraint on stripe_payment_intent_id).
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

export async function POST(req: Request) {
  if (!isAdminSupabaseConfigured) {
    return NextResponse.json({ error: 'Server not configured for webhooks.' }, { status: 500 });
  }

  const signature = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) {
    return NextResponse.json({ error: 'Missing signature/secret.' }, { status: 400 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: `Signature verification failed: ${message}` }, { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      // Card payments are already 'paid' here. ACH sessions come through
      // 'unpaid' at this point — those settle via the async events below.
      if (session.payment_status === 'paid') await recordPayment(session, 'succeeded');
      break;
    }
    case 'checkout.session.async_payment_succeeded': {
      await recordPayment(event.data.object as Stripe.Checkout.Session, 'succeeded');
      break;
    }
    case 'checkout.session.async_payment_failed': {
      await recordPayment(event.data.object as Stripe.Checkout.Session, 'failed');
      break;
    }
    default:
      break; // ignore everything else
  }

  return NextResponse.json({ received: true });
}
