// Server-only Web Push helper. Signs messages with the VAPID keypair and sends
// them to every device a profile has subscribed. Runs on the Node runtime
// (web-push needs Node crypto) — never import from a client component.
import webpush from 'web-push';
import { getAdminSupabase } from '@/lib/supabase/admin';

export const isPushConfigured = Boolean(
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
);

let vapidReady = false;
function ensureVapid() {
  if (vapidReady) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  vapidReady = true;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

// Fan a payload out to a set of subscriptions. Returns how many devices were
// reached. Subscriptions the push service reports as gone (404/410) are deleted
// so dead endpoints don't accumulate and error on every future send.
async function sendToSubs(
  admin: ReturnType<typeof getAdminSupabase>,
  subs: Sub[],
  payload: PushPayload,
): Promise<number> {
  if (subs.length === 0) return 0;
  const body = JSON.stringify(payload);
  const dead: string[] = [];
  let sent = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        sent += 1;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) dead.push(s.id);
        // Other errors (e.g. transient network) are swallowed — the caller only
        // needs the reached count; a retry queue is out of scope here.
      }
    }),
  );

  if (dead.length) {
    await admin.from('push_subscriptions').delete().in('id', dead);
  }
  return sent;
}

// Send `payload` to all of a profile's subscriptions. Returns devices reached.
export async function sendPushToProfile(profileId: string, payload: PushPayload): Promise<number> {
  if (!isPushConfigured) throw new Error('Web Push is not configured (missing VAPID keys).');
  ensureVapid();

  const admin = getAdminSupabase();
  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('profile_id', profileId);
  if (error) throw new Error(error.message);
  return sendToSubs(admin, (subs ?? []) as Sub[], payload);
}

// Broadcast `payload` to every non-inactive member of a chapter (across all of
// their devices). `excludeProfileId` skips one profile — typically the actor who
// triggered the notification, so they aren't pinged about their own action.
// `roles` optionally restricts to members with those access roles (e.g.
// ['admin','exec'] for an officers-only announcement). Returns devices reached.
export async function sendPushToChapter(
  chapterId: string,
  payload: PushPayload,
  opts: { excludeProfileId?: string | null; roles?: Array<'admin' | 'exec' | 'member'> } = {},
): Promise<number> {
  if (!isPushConfigured) throw new Error('Web Push is not configured (missing VAPID keys).');
  ensureVapid();

  const admin = getAdminSupabase();
  let query = admin
    .from('memberships')
    .select('profile_id, status, access_role')
    .eq('chapter_id', chapterId)
    .neq('status', 'inactive');
  if (opts.roles && opts.roles.length) query = query.in('access_role', opts.roles);
  const { data: mems, error: e1 } = await query;
  if (e1) throw new Error(e1.message);

  const profileIds = [
    ...new Set(
      (mems ?? [])
        .map((m: { profile_id: string | null }) => m.profile_id)
        .filter((id): id is string => Boolean(id) && id !== opts.excludeProfileId),
    ),
  ];
  if (profileIds.length === 0) return 0;

  const { data: subs, error: e2 } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('profile_id', profileIds);
  if (e2) throw new Error(e2.message);
  return sendToSubs(admin, (subs ?? []) as Sub[], payload);
}
