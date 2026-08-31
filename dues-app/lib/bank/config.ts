// Same one-switch convention as ../config.ts: with the env vars absent the app
// runs on the mock provider and never imports the Plaid SDK at runtime.
export const isPlaidConfigured = Boolean(
  process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET,
);

export const plaidEnv = process.env.PLAID_ENV ?? 'sandbox';

/**
 * Creating a bank connection is gated behind a deploy-level flag, not a UI
 * affordance. Plaid's Trial plan allows 10 Production Items **for the lifetime of
 * the team** — "removing Items created on a Trial plan will not allow you to
 * create more Items" — so every fresh Link permanently consumes one. The
 * treasurer changes annually; if reconnecting were ever one mis-click away from
 * a new Item, the chapter would burn its allowance in a few handoffs.
 *
 * Set this for the single deploy that performs the first connect, then remove it.
 * Reconnecting never needs it: update mode reuses the existing Item.
 */
export const canCreateNewItem = process.env.PLAID_ALLOW_NEW_ITEM === 'true';
