'use server';

import { getServerSupabase } from '@/lib/supabase/server';
import { CHAPTER_ID } from '@/lib/chapter';
import { sendPushToChapter, isPushConfigured } from '@/lib/push';

export interface EventInput {
  title: string;
  type: string;
  startsAt: string;
  endsAt: string | null;
  location: string;
  description: string;
  partifulUrl: string | null;
  // Client-formatted "Fri, Apr 17, 9:00 PM" for the creation notification —
  // formatted on the client so it reflects the chapter's timezone, not the
  // server's (Vercel runs UTC).
  whenLabel?: string;
}

const toRow = (i: EventInput) => ({
  name: i.title,
  type: i.type,
  starts_at: i.startsAt,
  ends_at: i.endsAt,
  location: i.location,
  description: i.description,
  partiful_url: i.partifulUrl,
  // Socials are never mandatory and never carry points or attendance — enforced
  // here so the DB row is authoritative no matter what the client sends.
  required: false,
  points: 0,
});

// The signed-in user's profile id, so we can skip notifying the creator about
// their own event. Null if not resolvable (never blocks the action).
async function currentProfileId(sb: ReturnType<typeof getServerSupabase>): Promise<string | null> {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from('profiles').select('id').eq('auth_user_id', user.id).maybeSingle();
  return data?.id ?? null;
}

// Create / edit / delete are exec-only — RLS (events_cud) enforces it server-side.
export async function createEvent(input: EventInput) {
  const sb = getServerSupabase();
  const { error } = await sb.from('events').insert({ chapter_id: CHAPTER_ID, ...toRow(input) });
  if (error) throw new Error(error.message);

  // Best-effort: push a heads-up to the chapter that a new social is on the
  // calendar. A push failure must never fail the event creation, so it's
  // wrapped and swallowed.
  if (isPushConfigured) {
    try {
      const creatorProfileId = await currentProfileId(sb);
      const parts = [input.whenLabel, input.location].filter(Boolean);
      await sendPushToChapter(
        CHAPTER_ID,
        {
          title: `New social: ${input.title}`,
          body: parts.length ? parts.join(' · ') : 'Tap to see it on the Socials tab.',
          url: '/socials',
          tag: 'social-new',
        },
        { excludeProfileId: creatorProfileId },
      );
    } catch {
      /* notification is best-effort — ignore */
    }
  }
}

export async function updateEvent(id: string, input: EventInput) {
  const sb = getServerSupabase();
  const { error } = await sb.from('events').update(toRow(input)).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteEvent(id: string) {
  const sb = getServerSupabase();
  const { error } = await sb.from('events').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// Note: socials carry no per-member state in the app. RSVPs are handled entirely
// in Partiful (each social has an optional invite link). Meeting attendance lives
// on the Attendance tab, keyed off `meetings`, not events.
