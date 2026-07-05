// Sends a test push to every device the signed-in member has subscribed. Wired
// to the "Send a test notification" button in account settings so a member can
// confirm notifications actually land on their phone.
import { NextResponse } from 'next/server';
import { getServerSupabase, isSupabaseConfigured } from '@/lib/supabase/server';
import { sendPushToProfile, isPushConfigured } from '@/lib/push';

export async function POST() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Notifications require the live backend.' }, { status: 400 });
  }
  if (!isPushConfigured) {
    return NextResponse.json({ error: 'Push notifications are not configured on the server.' }, { status: 503 });
  }

  const sb = getServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const { data: profile } = await sb
    .from('profiles').select('id, full_name').eq('auth_user_id', user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: 'No member profile on file.' }, { status: 403 });

  const first = (profile.full_name || '').split(' ')[0] || 'brother';
  let sent: number;
  try {
    sent = await sendPushToProfile(profile.id, {
      // Title is the message itself — the OS already tags it "from Phi Psi", so
      // repeating the chapter name here reads as "Phi Kappa Psi from Phi Psi".
      title: 'Notifications are on 🔔',
      body: `It works, ${first}! You'll get chapter updates right here.`,
      url: '/',
      tag: 'pkp-test',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not send notification.';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (sent === 0) {
    return NextResponse.json(
      { error: 'No subscribed devices found. Enable notifications first.' },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, sent });
}
