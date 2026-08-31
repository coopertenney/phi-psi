// One switch for the whole bank feed, mirroring lib/db.ts: credentials present →
// Plaid, absent → the in-memory feed. Nothing downstream branches on this, and
// the app never imports the Plaid SDK at runtime without credentials.

import { isPlaidConfigured } from './config';
import { mockBankProvider } from './mock-provider';
import { plaidProvider } from './plaid';
import type { BankProvider } from './types';

export const bankProvider: BankProvider = isPlaidConfigured ? plaidProvider : mockBankProvider;

export const isBankLive = isPlaidConfigured;
