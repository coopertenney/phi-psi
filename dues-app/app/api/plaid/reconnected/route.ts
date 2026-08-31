import { NextResponse } from 'next/server';
import { runSync } from '@/lib/bank/sync';
import { bankProvider } from '@/lib/bank/provider';
import { syncStore } from '@/lib/bank/store';
import { clearReauth } from '@/lib/bank/token-store';
import { db, isMockBackend } from '@/lib/db';
import { getServerSupabase } from '@/lib/supabase/server';

// Where Link's update mode lands. It clears the re-auth flag and syncs — it does
// NOT exchange a token, because update mode doesn't produce a new Item and the
// stored access token stays valid. The cursor survives too, which is the other
// reason update mode matters: a fresh Item would invalidate it and force a full
// replay of every transaction.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  if (!isMockBackend) {
    const { data } = await getServerSupabase().auth.getUser();
    if (!data.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    await clearReauth();
    const result = await runSync({
      provider: bankProvider,
      backend: db,
      store: syncStore,
      trigger: 'manual',
      actor: 'Reconnect',
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not finish reconnecting.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
