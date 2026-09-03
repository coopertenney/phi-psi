// One switch for the whole bank feed, mirroring lib/db.ts: credentials present →
// Plaid, absent → the in-memory feed. Nothing downstream branches on this, and
// the app never imports the Plaid SDK at runtime without credentials.

import { isPlaidConfigured } from './config';
import { mockBankProvider } from './mock-provider';
import { plaidProvider } from './plaid';
import { isTokenStoreLive } from './token-store';
import type { BankProvider } from './types';

// Both halves or neither. A real bank connection needs somewhere to keep its
// access token, and that is a service-role Supabase client — so Plaid
// credentials WITHOUT a database is not a half-working configuration, it is a
// broken one: the sync would fire the practice feed's placeholder token at
// Plaid's API and fail on every run.
//
// This is the ordinary state on a laptop: keys in .env.local so the sandbox
// script can run, no Supabase project yet. The app stays on the practice feed
// until both are present.
export const isBankLive = isPlaidConfigured && isTokenStoreLive;

export const bankProvider: BankProvider = isBankLive ? plaidProvider : mockBankProvider;
