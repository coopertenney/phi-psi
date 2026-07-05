// Saves (upserts) a browser's Web Push subscription for the signed-in member.
// Keyed on the push `endpoint` (unique) so re-subscribing the same device just
// refreshes the row rather than piling up duplicates. Runs as the user via the
// per-request server client, so RLS confirms the profile_id is really theirs.
import { NextResponse } from 'next/server';
import { getServerSupabase, isSupabaseConfigured } from '@/lib/supabase/server';

type SubBody = {
  subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
};

export async function POST(req: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Notifications require the live backend.' }, { status: 400 });
  }

  let body: SubBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const sub = body.subscription;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'Malformed push subscription.' }, { status: 400 });
  }

  const sb = getServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { data: profile } = await sb
    .from('profiles').select('id').eq('auth_user_id', user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: 'No member profile on file.' }, { status: 403 });

  const { error } = await sb
    .from('push_subscriptions')
    .upsert(
      {
        profile_id: profile.id,
        endpoint,
        p256dh,
        auth,
        user_agent: req.headers.get('user-agent'),
      },
      { onConflict: 'endpoint' },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
