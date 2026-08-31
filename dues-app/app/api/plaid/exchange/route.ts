import { NextResponse, type NextRequest } from 'next/server';
import { bankProvider } from '@/lib/bank/provider';
import { saveConnection } from '@/lib/bank/token-store';
import { isMockBackend } from '@/lib/db';
import { getServerSupabase } from '@/lib/supabase/server';

// Where a brand-new Item's token is stored. Reached only by connect mode —
// reconnecting posts to /api/plaid/reconnected instead, and the two never share
// a code path, so a reconnect cannot fall through to here by accident.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isMockBackend) {
    const { data } = await getServerSupabase().auth.getUser();
    if (!data.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const publicToken = String(body.publicToken ?? '');
    const ingestFrom = String(body.ingestFrom ?? '').slice(0, 10);
    if (!publicToken) throw new Error('The bank did not return a token.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ingestFrom)) {
      throw new Error('Pick the date to start counting payments from.');
    }

    const { accessToken, itemId } = await bankProvider.exchangePublicToken(publicToken);
    const [accounts, institutionName] = await Promise.all([
      bankProvider.getAccounts(accessToken),
      bankProvider.getInstitutionName(accessToken),
    ]);

    // Only pick the account automatically when there is no ambiguity. With two
    // depository accounts an internal transfer would read as a dues payment, so
    // the sync refuses to run until a human chooses.
    const depository = accounts.filter((a) => a.type === 'depository');
    const only = depository.length === 1 ? depository[0] : null;

    await saveConnection({
      accessToken,
      itemId,
      accountId: only?.accountId ?? null,
      ingestFrom,
      institutionName,
      accountName: only?.name ?? null,
      accountMask: only?.mask ?? null,
    });

    return NextResponse.json({ ok: true, needsAccountChoice: !only, accounts: depository });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not finish connecting.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
