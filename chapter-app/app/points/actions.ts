'use server';

import { getServerSupabase } from '@/lib/supabase/server';
import { requireMembershipId } from '@/lib/membership';
import { CHAPTER_ID } from '@/lib/chapter';
import type { AttendanceState, TermStatusKind } from '@/lib/types';

// Exec-only — RLS (points_entries_cud) enforces it server-side. `points` is
// passed explicitly rather than re-derived from the item, since discretionary
// items (the sheet's "?" rows) have exec-chosen values with no catalog default.
export async function logPoints(membershipId: string, itemId: string, points: number, approvedBy: string) {
  const sb = getServerSupabase();
  const { error } = await sb.from('points_entries').insert({
    membership_id: membershipId,
    item_id: itemId,
    points,
    approved_by: approvedBy,
    status: 'approved',   // exec-logged entries count immediately (vs. member requests)
  });
  if (error) throw new Error(error.message);
}

// Member self-log: a REQUEST, not an award. RLS (points_entries_self_request)
// is the real gate — it allows this only for the caller's own membership, a
// reward/non-discretionary item, at the item's catalog value. Lands as 'pending'
// and does NOT count toward totals until an exec approves it.
export async function requestPoints(membershipId: string, itemId: string, points: number) {
  const sb = getServerSupabase();
  const { error } = await sb.from('points_entries').insert({
    membership_id: membershipId,
    item_id: itemId,
    points,
    status: 'pending',
  });
  if (error) throw new Error(error.message);
}

// Exec approves a pending member request → it starts counting. RLS
// (points_entries_cud) gates this to exec. The approver name is resolved
// server-side from the signed-in profile so the exec doesn't retype it per row
// (the whole point is approving at a glance).
export async function approvePointEntry(entryId: string) {
  const sb = getServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  let approvedBy = 'Exec';
  if (user) {
    const { data: prof } = await sb.from('profiles').select('full_name').eq('auth_user_id', user.id).maybeSingle();
    if (prof?.full_name) approvedBy = prof.full_name;
  }
  const { error } = await sb.from('points_entries')
    .update({ status: 'approved', approved_by: approvedBy }).eq('id', entryId);
  if (error) throw new Error(error.message);
}

// Exec rejects a pending request → the row is removed. Exec-only via RLS.
export async function rejectPointEntry(entryId: string) {
  const sb = getServerSupabase();
  const { error } = await sb.from('points_entries').delete().eq('id', entryId);
  if (error) throw new Error(error.message);
}

// Member withdraws their OWN still-pending request. Same DELETE, but gated by
// the points_entries_self_withdraw policy (own row + status='pending') rather
// than the exec policy — so a member can cancel a request an exec hasn't acted on.
export async function withdrawPointRequest(entryId: string) {
  const sb = getServerSupabase();
  const { error } = await sb.from('points_entries').delete().eq('id', entryId);
  if (error) throw new Error(error.message);
}

// Edit a catalog item's point value. Exec-only — RLS (point_items_cud) enforces
// it server-side. This changes FUTURE awards only: points_entries.points is a
// snapshot copied at log time, so past entries and existing totals are untouched.
export async function updatePointItem(itemId: string, points: number) {
  const sb = getServerSupabase();
  const { error } = await sb.from('point_items').update({ points }).eq('id', itemId);
  if (error) throw new Error(error.message);
}

/* ─────────────────────────── Attendance ───────────────────────────
   Exec takes chapter attendance. All three actions are exec-only via RLS
   (attendance_cud / mts_cud). member_term_statuses seeds the grid; recording
   attendance never rewrites past meetings — it only upserts the rows exec saves. */

type ServerSupabase = ReturnType<typeof getServerSupabase>;

async function currentTermId(sb: ServerSupabase): Promise<string> {
  const { data } = await sb
    .from('terms').select('id').eq('chapter_id', CHAPTER_ID).eq('is_current', true).maybeSingle();
  if (!data) throw new Error('No current term is set for this chapter.');
  return data.id;
}

export interface AttendanceInput {
  meetingId: string | null;   // null → create a new meeting from title/heldOn
  title: string;
  heldOn: string;             // ISO date (YYYY-MM-DD)
  entries: { membershipId: string; state: AttendanceState }[];
}

// Create-or-use the meeting, then upsert every member's state in one shot.
// Returns the meeting id (freshly created, or the one passed in).
export async function recordAttendance(input: AttendanceInput): Promise<string> {
  const sb = getServerSupabase();
  let meetingId: string;
  if (input.meetingId) {
    meetingId = input.meetingId;
  } else {
    const term_id = await currentTermId(sb);
    const { data, error } = await sb
      .from('meetings')
      .insert({ chapter_id: CHAPTER_ID, term_id, title: input.title.trim() || 'Chapter meeting', held_on: input.heldOn })
      .select('id').single();
    if (error) throw new Error(error.message);
    meetingId = data.id;
  }
  if (input.entries.length) {
    const rows = input.entries.map((e) => ({ meeting_id: meetingId, membership_id: e.membershipId, state: e.state }));
    const { error } = await sb.from('attendance').upsert(rows, { onConflict: 'meeting_id,membership_id' });
    if (error) throw new Error(error.message);
  }
  return meetingId;
}

// Set/replace a member's standing status for the current term (abroad / recurring excuse).
export async function setTermStatus(membershipId: string, kind: TermStatusKind, reason: string) {
  const sb = getServerSupabase();
  const createdBy = await requireMembershipId(sb);   // also proves signed-in
  const term_id = await currentTermId(sb);
  const { error } = await sb.from('member_term_statuses').upsert(
    { chapter_id: CHAPTER_ID, membership_id: membershipId, term_id, kind, reason: reason.trim() || null, created_by: createdBy },
    { onConflict: 'membership_id,term_id' },
  );
  if (error) throw new Error(error.message);
}

// Clear a member's standing status for the current term.
export async function clearTermStatus(membershipId: string) {
  const sb = getServerSupabase();
  const term_id = await currentTermId(sb);
  const { error } = await sb.from('member_term_statuses')
    .delete().eq('membership_id', membershipId).eq('term_id', term_id);
  if (error) throw new Error(error.message);
}

/* ─────────────────────────── Rotating room-code check-in ───────────────────────────
   See app-foundation/checkin.sql. Exec opens/closes + reads the live code (exec-only
   RPCs); a member self-checks-in via self_check_in_code, which derives their membership
   from auth.uid() and verifies the code server-side — the only member self-write path. */

// Exec: open or close check-in for a meeting (regenerates the code seed on open).
export async function setMeetingCheckin(meetingId: string, open: boolean) {
  const sb = getServerSupabase();
  const { error } = await sb.rpc('set_meeting_checkin', { p_meeting: meetingId, p_open: open });
  if (error) throw new Error(error.message);
}

// Exec: current 6-digit code + how many are checked in (present) — polled by the
// live check-in screen.
export async function checkinStatus(meetingId: string): Promise<{ code: string | null; present: number }> {
  const sb = getServerSupabase();
  const { data: code, error } = await sb.rpc('current_checkin_code', { p_meeting: meetingId });
  if (error) throw new Error(error.message);
  const { count } = await sb.from('attendance')
    .select('id', { count: 'exact', head: true }).eq('meeting_id', meetingId).eq('state', 'present');
  return { code: (code as string | null) ?? null, present: count ?? 0 };
}

// Member: self-check-in with the code shown on the exec's screen → marks present.
export async function selfCheckIn(meetingId: string, code: string) {
  const sb = getServerSupabase();
  const { error } = await sb.rpc('self_check_in_code', { p_meeting: meetingId, p_code: code.trim() });
  if (error) throw new Error(error.message);
}
