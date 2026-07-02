// Server-only Stripe client. Never import this from a client component — the
// secret key must not reach the browser. Lazy + cached, mirroring the
// Supabase browser singleton's shape (see lib/supabase/browser.ts).
import Stripe from 'stripe';

export const isStripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (!cached) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set — Stripe payments are not configured.');
    cached = new Stripe(key, { apiVersion: '2025-02-24.acacia' });
  }
  return cached;
}
