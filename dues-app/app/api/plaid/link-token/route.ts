import { NextResponse } from 'next/server';
import { bankProvider } from '@/lib/bank/provider';
import { canCreateNewItem } from '@/lib/bank/config';
import { getConnection, withAccessToken } from '@/lib/bank/token-store';
import { isMockBackend } from '@/lib/db';
import { getServerSupabase } from '@/lib/supabase/server';

// The mode is decided HERE, from the database — never from a request parameter.
// A caller cannot ask for "connect" mode, because the dangerous intent is not
// expressible: if a connection exists this returns an update-mode token, full
// stop. See lib/bank/config.ts for why a second Item is unrecoverable.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  // middleware.ts excludes /api, so every route authorizes itself.
  if (!isMockBackend) {
    const { data } = await getServerSupabase().auth.getUser();
    if (!data.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const existing = await getConnection();

    if (existing.connected) {
      const token = await withAccessToken((accessToken) =>
        bankProvider.createLinkToken({ accessToken }));
      return NextResponse.json({ linkToken: token, mode: 'update' });
    }

    if (!canCreateNewItem) {
      return NextResponse.json({
        error:
          'This app holds exactly one bank connection. Creating another permanently '
          + 'consumes one of ten lifetime Plaid connections and cannot be undone. '
          + 'Set PLAID_ALLOW_NEW_ITEM=true for the single deploy that connects the '
          + 'account, then remove it.',
      }, { status: 409 });
    }

    const token = await bankProvider.createLinkToken({});
    return NextResponse.json({ linkToken: token, mode: 'connect' });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not start the bank connection.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
