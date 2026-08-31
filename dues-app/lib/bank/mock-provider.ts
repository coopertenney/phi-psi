// A deterministic fake feed, so the money-critical path runs with no Plaid
// account and no Supabase project. It is not a stub: it walks the three
// transitions that are hardest to get right and easiest to break —
//
//   call 1  the walkthrough credits arrive, one of them pending
//   call 2  that pending credit is replaced by its posted twin (promotion)
//   call 3  a settled credit is removed by the bank (reversal)
//
// which means every `npm run dev` and every run of scripts/check-sync.ts
// exercises promotion, removal and reversal rather than only the happy path.

import { ROSTER } from '../roster';
import { buildSampleCredits } from '../sample';
import type { BankAccount, BankProvider, FeedPage, FeedTxn } from './types';

export const MOCK_ACCOUNT_ID = 'mock-checking';
const DUES_CENTS = 45000;
const START = '2026-10-03';

const members = ROSTER.map((r, i) => ({
  id: `m${i + 1}`, name: r.name, aka: [], photoUrl: null, financialAid: false,
}));

function credits(): FeedTxn[] {
  const sample = buildSampleCredits(members, DUES_CENTS, START);
  return sample.credits.map((c, i) => ({
    providerTxnId: `mock-txn-${i}`,
    accountId: MOCK_ACCOUNT_ID,
    postedOn: c.postedOn,
    amountCents: c.amountCents,
    rawDescription: c.rawDescription,
    // The first credit arrives pending, the way a real Zelle payment does.
    pending: i === 0,
    pendingTxnId: null,
  }));
}

// State lives on globalThis for the same reason the mock store's does: Next
// compiles a server bundle per route in dev, so module-level state would give
// each route its own copy of "which page comes next".
const globalStore = globalThis as unknown as { __duesMockFeed?: { page: number } };
const state = (globalStore.__duesMockFeed ??= { page: 0 });

export function resetMockFeed() { state.page = 0; }

export const mockBankProvider: BankProvider = {
  name: 'Mock bank',

  async syncTransactions(): Promise<FeedPage> {
    const page = state.page++;
    const all = credits();

    if (page === 0) {
      return { added: all, modified: [], removed: [], nextCursor: 'mock-cursor-1', hasMore: false };
    }

    if (page === 1) {
      // The pending credit settles: a NEW provider id that names the pending one
      // it replaces, and the pending id reported removed in the same page — the
      // exact shape that double-counts a payment if promotion isn't handled.
      const pending = all[0];
      const posted: FeedTxn = {
        ...pending,
        providerTxnId: `${pending.providerTxnId}-posted`,
        pending: false,
        pendingTxnId: pending.providerTxnId,
      };
      return {
        added: [posted],
        modified: [],
        removed: [pending.providerTxnId],
        nextCursor: 'mock-cursor-2',
        hasMore: false,
      };
    }

    if (page === 2) {
      // The bank takes back the second credit. If it was applied, this must
      // reverse the payment rather than leave the brother marked paid.
      return {
        added: [], modified: [], removed: [all[1].providerTxnId],
        nextCursor: 'mock-cursor-3', hasMore: false,
      };
    }

    return { added: [], modified: [], removed: [], nextCursor: `mock-cursor-${page}`, hasMore: false };
  },

  async createLinkToken() { return 'mock-link-token'; },
  async exchangePublicToken() { return { accessToken: 'mock-access-token', itemId: 'mock-item' }; },
  async getAccounts(): Promise<BankAccount[]> {
    return [
      { accountId: MOCK_ACCOUNT_ID, name: 'Chapter Checking', mask: '1234', type: 'depository', subtype: 'checking' },
      { accountId: 'mock-savings', name: 'Chapter Savings', mask: '5678', type: 'depository', subtype: 'savings' },
    ];
  },
  async getInstitutionName() { return 'Stanford Federal Credit Union (mock)'; },
};
