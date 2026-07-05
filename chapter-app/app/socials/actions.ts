'use server';

import { getServerSupabase } from '@/lib/supabase/server';
import { requireMembershipId } from '@/lib/membership';
import { CHAPTER_ID } from '@/lib/chapter';
import { sendPushToChapter, isPushConfigured } from '@/lib/push';

export interface EventInput {
  title: string;
  type: string;
  startsAt: string;
  endsAt: string | null;
  location: string;
  description: string;
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
          body: parts.length ? parts.join(' · ') : 'Tap to RSVP on the Socials tab.',
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

// Set (or clear) the signed-in member's own RSVP. RLS (rsvps_mine) ensures a
// member can only write their own row.
export async function setRsvp(eventId: string, status: 'going' | 'maybe' | 'no' | null) {
  const sb = getServerSupabase();
  const membershipId = await requireMembershipId(sb);

  if (status === null) {
    const { error } = await sb.from('rsvps').delete().eq('event_id', eventId).eq('membership_id', membershipId);
    if (error) throw new Error(error.message);
    return;
  }

  const dbStatus = status === 'no' ? 'declined' : status;
  const { error } = await sb
    .from('rsvps')
    .upsert({ event_id: eventId, membership_id: membershipId, status: dbStatus }, { onConflict: 'event_id,membership_id' });
  if (error) throw new Error(error.message);
}

// Note: socials never carry attendance or points — RSVPs are the only per-member
// signal here. Meeting attendance lives on the Attendance tab, keyed off
// `meetings`, not events.
