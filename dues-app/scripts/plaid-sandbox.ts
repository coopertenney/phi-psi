// Drives a real Plaid sandbox connection over the API — no browser, no Link.
//
//   npx tsx scripts/plaid-sandbox.ts
//
// /sandbox/public_token/create mints a public token directly, which is the
// same thing Link hands back. So the whole path runs against Plaid's actual
// servers: exchange → accounts → transactions/sync → our own mapper.
//
// What this proves, and what it cannot:
//   ✓ the credentials work, and the request shape is right
//   ✓ the sign flip (Plaid: positive = money OUT for depository)
//   ✓ whether original_description comes back when asked for
//   ✗ what Stanford FCU's Zelle descriptor actually looks like — sandbox
//     invents its own transactions, so only the real account answers that
//
// Sandbox Items do not count against the ten production connections.
// Prints no token and no secret.

import { readFileSync } from 'fs';
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { toFeedTxn } from '../lib/bank/plaid';
import { partitionFeed } from '../lib/bank/sync';
import { formatCents } from '../lib/money';

// The script runs outside Next, so .env.local isn't loaded for us.
function loadEnv() {
  const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  text.split('\n').forEach((line) => {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
}

const rule = (t: string) => console.log(`\n${'─'.repeat(76)}\n${t}\n${'─'.repeat(76)}`);

async function main() {
  loadEnv();
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) throw new Error('PLAID_CLIENT_ID / PLAID_SECRET missing from .env.local');
  console.log(`client id ${clientId.slice(0, 6)}…  secret ${secret.length} chars  env sandbox`);

  const plaid = new PlaidApi(new Configuration({
    basePath: PlaidEnvironments.sandbox,
    baseOptions: { headers: { 'PLAID-CLIENT-ID': clientId, 'PLAID-SECRET': secret } },
  }));

  rule('STEP 1 — mint a sandbox connection (what Link would hand back)');
  const pub = await plaid.sandboxPublicTokenCreate({
    institution_id: 'ins_109508',              // First Platypus Bank, Plaid's test institution
    initial_products: ['transactions' as any],
  });
  console.log('  public token received');

  rule('STEP 2 — exchange it for an access token');
  const ex = await plaid.itemPublicTokenExchange({ public_token: pub.data.public_token });
  const accessToken = ex.data.access_token;    // never printed
  console.log(`  item id ${ex.data.item_id}`);

  rule('STEP 3 — the accounts on this connection');
  const accounts = await plaid.accountsGet({ access_token: accessToken });
  accounts.data.accounts.forEach((a) => console.log(
    `  ${a.name.padEnd(22)} ${String(a.type).padEnd(12)} ${String(a.subtype ?? '').padEnd(10)} ••${a.mask ?? '????'}`,
  ));
  const checking = accounts.data.accounts.find((a) => a.subtype === 'checking')
    ?? accounts.data.accounts[0];
  console.log(`\n  the dues account would be: ${checking.name} ••${checking.mask}`);

  rule('STEP 4 — /transactions/sync, asking for the raw descriptor');
  // A freshly created Item has no transactions until Plaid finishes its first
  // pull. Real life has the same shape — this is why the sync is a cursor loop
  // that can legitimately come back empty and be retried, not a one-shot.
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let cursor: string | undefined;
  let added: any[] = [];

  for (let attempt = 1; attempt <= 12; attempt++) {
    cursor = undefined;
    added = [];
    for (let page = 0; page < 10; page++) {
      const res = await plaid.transactionsSync({
        access_token: accessToken,
        cursor,
        count: 500,
        options: { include_original_description: true },
      });
      added = added.concat(res.data.added);
      cursor = res.data.next_cursor;
      if (!res.data.has_more) break;
    }
    if (added.length) { console.log(`  ready after ${attempt} attempt${attempt === 1 ? '' : 's'}`); break; }
    process.stdout.write(`  waiting for Plaid's first pull (${attempt}/12)\r`);
    await wait(2500);
  }
  console.log(`  ${added.length} transactions, cursor ${cursor?.slice(0, 12)}…`);

  const withOriginal = added.filter((t) => t.original_description != null).length;
  console.log(`  original_description present on ${withOriginal} of ${added.length}`);

  rule('STEP 5 — raw Plaid, next to what our mapper makes of it');
  console.log('  plaid.amount   →  ours          direction     description');
  added.slice(0, 10).forEach((t) => {
    const f = toFeedTxn(t);
    console.log(
      `  ${String(t.amount).padStart(9)}  →  ${formatCents(f.amountCents).padStart(10)}`
      + `   ${(f.amountCents > 0 ? 'money IN' : 'money OUT').padEnd(10)}`
      + `  ${f.rawDescription.slice(0, 40)}`,
    );
  });

  rule('STEP 6 — the filter that decides what reaches the ledger');
  const feed = added.map(toFeedTxn);
  const part = partitionFeed(feed, { accountId: checking.account_id, ingestFrom: null });
  console.log(`  kept as dues candidates:   ${part.keep.length}`);
  console.log(`  chapter spending dropped:  ${part.droppedDebitCount}`);
  console.log(`  other account dropped:     ${part.droppedOtherAccountCount}`);

  rule('VERDICT');
  const credits = feed.filter((f) => f.amountCents > 0).length;
  const debits = feed.filter((f) => f.amountCents < 0).length;
  console.log(`  ${credits} money-in, ${debits} money-out after the sign flip.`);
  console.log(credits > 0 && debits > 0
    ? '  Both directions present — the flip is not inverting everything one way.'
    : '  SUSPICIOUS: everything landed on one side. Check the sign.');
  console.log(withOriginal === added.length
    ? '  original_description came back on every transaction.'
    : `  original_description missing on ${added.length - withOriginal} — the matcher would fall back to Plaid's cleaned name there.`);
  console.log('\n  What this does NOT answer: Stanford FCU\'s real Zelle descriptor.');
  console.log('  Sandbox invents its own merchants. Only the live account settles that.');
}

main().catch((e: any) => {
  const code = e?.response?.data?.error_code;
  const msg = e?.response?.data?.error_message ?? e.message;
  console.error(`\nFAILED${code ? ` [${code}]` : ''}: ${msg}`);
  process.exit(1);
});
