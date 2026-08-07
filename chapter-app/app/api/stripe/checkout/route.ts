// Creates a Stripe Checkout Session for the signed-in member's dues balance
// or fines, and hands the client a redirect URL. Card + US bank debit (ACH)
// are both offered — ACH settles a few days later via the async webhook
// events (see app/api/stripe/webhook/route.ts).
//
// Gated on two independent switches, checked server-side (never trust the
// client here): the Finance Officer's `chapters.dues_payments_enabled` flag,
// and whether Stripe keys are configured at all.
import { NextResponse } from 'next/server';
import { getServerSupabase, isSupabaseConfigured } from '@/lib/supabase/server';
import { getStripe, isStripeConfigured } from '@/lib/stripe';
import { CHAPTER_ID } from '@/lib/chapter';

type CheckoutKind = 'dues' | 'fines';

export async function POST(req: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Payments require the live backend — not available in demo mode.' }, { status: 400 });
  }

  let body: { kind?: CheckoutKind; amountCents?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const kind: CheckoutKind = body.kind === 'fines' ? 'fines' : 'dues';
  // Fines can't be paid online yet: there's no live fines table, and a recorded
  // payment has no way to be attributed to a fine — member_finances nets ALL
  // succeeded payments against dues_charges, so a "fines" charge would silently
  // reduce the member's DUES balance instead. Reject it server-side (the member
  // UI already never shows a fines Pay button in live mode) until a fines table
  // + kind-aware recording exist. See lib/stripe-record.ts.
  if (kind === 'fines') {
    return NextResponse.json({ error: 'Fines can’t be paid online yet — ask your treasurer.' }, { status: 400 });
  }
  const requestedCents = Math.round(Number(body.amountCents));
  if (!Number.isFinite(requestedCents) || requestedCents < 50) {
    return NextResponse.json({ error: 'Invalid amount.' }, { status: 400 });
  }

  const sb = getServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { data: chapter, error: chapterErr } = await sb
    .from('chapters').select('dues_payments_enabled').eq('id', CHAPTER_ID).maybeSingle();
  if (chapterErr) return NextResponse.json({ error: chapterErr.message }, { status: 500 });
  if (!chapter?.dues_payments_enabled) {
    return NextResponse.json(
      { error: 'Online payments are currently turned off. Ask your treasurer how to pay.' },
      { status: 503 },
    );
  }
  if (!isStripeConfigured) {
    return NextResponse.json({ error: 'Payments are not set up yet.' }, { status: 503 });
  }

  const { data: profile } = await sb.from('profiles').select('id, full_name, email').eq('auth_user_id', user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: 'No member profile on file.' }, { status: 403 });

  const { data: membership } = await sb
    .from('memberships').select('id').eq('profile_id', profile.id).eq('chapter_id', CHAPTER_ID).maybeSingle();
  if (!membership) return NextResponse.json({ error: 'Not a member of this chapter.' }, { status: 403 });

  // Never trust the client's amount. Re-derive the real dues balance from
  // member_finances (RLS scopes this to the member's own row) and charge at
  // most that — so a stale or tampered client can't overpay into a negative
  // balance. Paying LESS than the balance is allowed (partial payment).
  const { data: fin } = await sb
    .from('member_finances').select('balance_cents').eq('membership_id', membership.id).maybeSingle();
  const balanceCents = fin?.balance_cents ?? 0;
  if (balanceCents < 50) {
    return NextResponse.json({ error: 'No dues balance to pay.' }, { status: 400 });
  }
  const amountCents = Math.min(requestedCents, balanceCents);

  const stripe = getStripe();
  const origin = process.env.NEXT_PUBLIC_SITE_URL || req.headers.get('origin') || 'http://localhost:3000';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card', 'us_bank_account'],
    customer_email: profile.email || undefined,
    line_items: [{
      price_data: {
        currency: 'usd',
        unit_amount: amountCents,
        product_data: { name: 'Chapter dues' },
      },
      quantity: 1,
    }],
    // No card data ever touches our DB — only this reference id + a status,
    // written by the webhook once Stripe confirms the charge (schema.sql).
    metadata: { membership_id: membership.id, chapter_id: CHAPTER_ID, kind },
    // session_id lets the return page verify the payment with Stripe and record
    // it synchronously (see confirmCheckoutOnReturn) — so the balance updates on
    // redirect without waiting for the webhook (which can't reach localhost).
    // Stripe substitutes the literal {CHECKOUT_SESSION_ID} template.
    success_url: `${origin}/finances?paid=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/finances?canceled=1`,
  });

  if (!session.url) return NextResponse.json({ error: 'Could not start checkout.' }, { status: 500 });
  return NextResponse.json({ url: session.url });
}
