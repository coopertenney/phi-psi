'use server';

import { revalidatePath } from 'next/cache';
import { requireMembershipId } from '@/lib/membership';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { getStripe, isStripeConfigured } from '@/lib/stripe';
import { recordCheckoutPayment } from '@/lib/stripe-record';

// Called on the Stripe success redirect (/finances?paid=1&session_id=…). Fetches
// the session straight from Stripe, and if it actually paid, records the payment
// (idempotent — a later webhook won't double-write). This is what makes the
// balance flip to "paid in full" on redirect without depending on the webhook,
// which can't reach localhost. Safe to call with a bogus/foreign id: it just
// no-ops or records that session's own real payment. Returns true if a paid
// session was confirmed.
export async function confirmCheckoutOnReturn(sessionId: string | undefined): Promise<boolean> {
  if (!sessionId || !isStripeConfigured) return false;
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') return false;
    await recordCheckoutPayment(session, 'succeeded');
    return true;
  } catch {
    return false; // bad/expired id — nothing to record
  }
}

// Demo helper: undo my own dues payment so "Dues paid in full" flips back to a
// balance owed, letting the Stripe pay flow be demoed again from scratch.
//
// Scoped to the SIGNED-IN member only: the membership id is resolved from the
// session (never passed by the client), so a member can only ever reset their
// own dues — not anyone else's. Runs through the service-role client because
// members have no delete policy on `payments` (only the Stripe webhook writes
// there); the session-resolved id is the safety boundary, not RLS.
//
// The dues *charge* is left intact, so deleting the payment restores the full
// balance (charged − 0). Every seeded member has one charge on file.
export async function resetMyDemoDues(): Promise<{ ok: true } | { ok: false; error: string }> {
  // Gate: this destructive convenience only exists in demo builds. Checked
  // server-side too (not just in the UI) so it can't be invoked in production
  // even if the client button were forced to render.
  if (process.env.NEXT_PUBLIC_DEMO_MODE !== '1') {
    return { ok: false, error: 'Demo reset is disabled.' };
  }

  let membershipId: string;
  try {
    membershipId = await requireMembershipId();
  } catch {
    return { ok: false, error: 'You must be signed in to reset your demo dues.' };
  }

  const admin = getAdminSupabase();
  const { error } = await admin.from('payments').delete().eq('membership_id', membershipId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/finances');
  return { ok: true };
}
