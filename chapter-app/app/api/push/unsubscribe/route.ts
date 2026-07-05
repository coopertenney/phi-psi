// Removes a browser's Web Push subscription (member turned notifications off on
// this device). RLS scopes the delete to the caller's own rows, so we only need
// the endpoint to identify which one.
import { NextResponse } from 'next/server';
import { getServerSupabase, isSupabaseConfigured } from '@/lib/supabase/server';

export async function POST(req: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Notifications require the live backend.' }, { status: 400 });
  }

  let body: { endpoint?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (!body.endpoint) {
    return NextResponse.json({ error: 'Missing endpoint.' }, { status: 400 });
  }

  const sb = getServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { error } = await sb.from('push_subscriptions').delete().eq('endpoint', body.endpoint);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
