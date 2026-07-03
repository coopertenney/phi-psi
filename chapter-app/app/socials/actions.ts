'use server';

import { getServerSupabase } from '@/lib/supabase/server';

const CHAPTER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

export interface EventInput {
  title: string;
  type: string;
  startsAt: string;
  endsAt: string | null;
  location: string;
  description: string;
  mandatory: boolean;
  pointsValue: number;
}

const toRow = (i: EventInput) => ({
  name: i.title,
  type: i.type,
  starts_at: i.startsAt,
  ends_at: i.endsAt,
  location: i.location,
  description: i.description,
  required: i.mandatory,
  points: i.pointsValue,
});

// Create / edit / delete are exec-only — RLS (events_cud) enforces it server-side.
export async function createEvent(input: EventInput) {
  const sb = getServerSupabase();
  const { error } = await sb.from('events').insert({ chapter_id: CHAPTER_ID, ...toRow(input) });
  if (error) throw new Error(error.message);
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
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: prof } = await sb.from('profiles').select('id').eq('auth_user_id', user.id).maybeSingle();
  const { data: mem } = prof
    ? await sb.from('memberships').select('id').eq('profile_id', prof.id).maybeSingle()
    : { data: null };
  if (!mem) throw new Error('You’re not on the roster');

  if (status === null) {
    const { error } = await sb.from('rsvps').delete().eq('event_id', eventId).eq('membership_id', mem.id);
    if (error) throw new Error(error.message);
    return;
  }

  const dbStatus = status === 'no' ? 'declined' : status;
  const { error } = await sb
    .from('rsvps')
    .upsert({ event_id: eventId, membership_id: mem.id, status: dbStatus }, { onConflict: 'event_id,membership_id' });
  if (error) throw new Error(error.message);
}

// Exec live check-in. Backs each event with a `meetings` row (find-or-create,
// linked via meetings.event_id) so attendance rolls into the same table the
// Attendance screen reads — one fact table, two views onto it.
export async function setAttendance(eventId: string, membershipId: string, present: boolean) {
  const sb = getServerSupabase();

  const { data: ev, error: eErr } = await sb.from('events').select('name, starts_at, chapter_id').eq('id', eventId).maybeSingle();
  if (eErr) throw new Error(eErr.message);
  if (!ev) throw new Error('Event not found');

  const { data: existing } = await sb.from('meetings').select('id').eq('event_id', eventId).maybeSingle();
  let meetingId = existing?.id as string | undefined;
  if (!meetingId) {
    const { data: created, error: mErr } = await sb
      .from('meetings')
      .insert({ chapter_id: ev.chapter_id, event_id: eventId, title: ev.name, held_on: String(ev.starts_at).slice(0, 10) })
      .select('id')
      .single();
    if (mErr) {
      // Unique violation (23505) means another concurrent check-in already
      // created the meeting for this event — fetch it instead of failing.
      if (mErr.code !== '23505') throw new Error(mErr.message);
      const { data: raced } = await sb.from('meetings').select('id').eq('event_id', eventId).maybeSingle();
      if (!raced) throw new Error(mErr.message);
      meetingId = raced.id;
    } else {
      meetingId = created.id;
    }
  }

  const { error } = await sb
    .from('attendance')
    .upsert(
      { meeting_id: meetingId, membership_id: membershipId, state: present ? 'present' : 'absent' },
      { onConflict: 'meeting_id,membership_id' },
    );
  if (error) throw new Error(error.message);
}
