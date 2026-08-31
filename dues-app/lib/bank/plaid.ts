// The only file that talks to Plaid. Every Plaid type stops here; everything
// downstream sees the FeedTxn shape in ./types.
//
// The client is built inside a function, never at module scope, so importing
// this file without credentials can't throw during `next build`.

import { Configuration, PlaidApi, PlaidEnvironments, type Transaction } from 'plaid';
import { plaidEnv } from './config';
import type {
  BankAccount, BankProvider, FeedPage, FeedTxn, LinkTokenInput, SyncPageInput,
} from './types';

// The treasurer changes every year. A per-exec id would make next year's
// update-mode link look like a different user, so this is deliberately constant.
const CLIENT_USER_ID = 'cal-beta-chapter';

let api: PlaidApi | null = null;

function plaid(): PlaidApi {
  if (api) return api;
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) throw new Error('Plaid is not configured.');
  api = new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[plaidEnv] ?? PlaidEnvironments.sandbox,
    baseOptions: { headers: { 'PLAID-CLIENT-ID': clientId, 'PLAID-SECRET': secret } },
  }));
  return api;
}

/**
 * Plaid transaction → FeedTxn.
 *
 * Two details decide whether this feature works at all:
 *
 * - **The sign.** Plaid reports depository accounts with POSITIVE = money out.
 *   Every credit in this app is positive. Get the flip backwards and every dues
 *   payment is classified as chapter spending and silently dropped.
 * - **Math.round.** `-450.00 * 100` can land on 44999.999…, and then no amount
 *   ever equals a charge exactly, tier `clear` never fires, and auto-apply
 *   quietly does nothing forever with no error anywhere.
 */
export function toFeedTxn(t: Transaction): FeedTxn {
  return {
    providerTxnId: t.transaction_id,
    accountId: t.account_id,
    postedOn: t.date,
    amountCents: Math.round(-t.amount * 100),
    // `name` and `merchant_name` are Plaid's cleaned strings — they strip exactly
    // the sender name the matcher needs. original_description requires
    // include_original_description on the request.
    rawDescription: t.original_description ?? t.name,
    pending: Boolean(t.pending),
    pendingTxnId: t.pending_transaction_id ?? null,
  };
}

export const plaidProvider: BankProvider = {
  name: 'Plaid',

  async syncTransactions({ accessToken, cursor }: SyncPageInput): Promise<FeedPage> {
    const res = await plaid().transactionsSync({
      access_token: accessToken,
      cursor: cursor ?? undefined,
      count: 500,
      options: { include_original_description: true },
    });
    const d = res.data;
    return {
      added: d.added.map(toFeedTxn),
      modified: d.modified.map(toFeedTxn),
      removed: d.removed.map((r) => r.transaction_id),
      nextCursor: d.next_cursor,
      hasMore: d.has_more,
    };
  },

  async createLinkToken({ accessToken }: LinkTokenInput): Promise<string> {
    // Update mode when a token exists: re-authenticating the EXISTING Item rather
    // than creating a second one. `products` must be omitted in update mode —
    // passing it is what turns a reconnect into a new Item, permanently
    // consuming one of ten lifetime slots. See ./config.ts.
    const updateMode = Boolean(accessToken);
    const res = await plaid().linkTokenCreate({
      user: { client_user_id: CLIENT_USER_ID },
      client_name: 'Cal Beta Dues Desk',
      country_codes: ['US' as any],
      language: 'en',
      ...(updateMode
        ? { access_token: accessToken as string }
        : {
          products: ['transactions' as any],
          // Fetching is free and discarding is cheap; the ingest_from floor is
          // what actually protects the ledger.
          transactions: { days_requested: 90 },
        }),
      ...(process.env.PLAID_WEBHOOK_URL ? { webhook: process.env.PLAID_WEBHOOK_URL } : {}),
    });
    return res.data.link_token;
  },

  async exchangePublicToken(publicToken: string) {
    const res = await plaid().itemPublicTokenExchange({ public_token: publicToken });
    return { accessToken: res.data.access_token, itemId: res.data.item_id };
  },

  async getAccounts(accessToken: string): Promise<BankAccount[]> {
    const res = await plaid().accountsGet({ access_token: accessToken });
    return res.data.accounts.map((a) => ({
      accountId: a.account_id,
      name: a.name,
      mask: a.mask ?? null,
      type: String(a.type),
      subtype: a.subtype ? String(a.subtype) : null,
    }));
  },

  async getInstitutionName(accessToken: string): Promise<string | null> {
    try {
      const item = await plaid().itemGet({ access_token: accessToken });
      const id = item.data.item.institution_id;
      if (!id) return null;
      const inst = await plaid().institutionsGetById({
        institution_id: id, country_codes: ['US' as any],
      });
      return inst.data.institution.name;
    } catch {
      return null;   // cosmetic; never fail a connect over a display name
    }
  },
};
