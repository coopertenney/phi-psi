import { getServerSupabase } from './supabase/server';
import type {
  MemberRow, PointItem, PointEntry, ScoreConfig, Term, MeetingRow, MemberTermStatus, AttendanceState,
} from './types';

export async function getMembers(): Promise<MemberRow[]> {
  const sb = getServerSupabase();
  const { data, error } = await sb.from('members').select('id, name, photo_url').order('name');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ id: r.id, name: r.name, photoUrl: r.photo_url }));
}

export async function getPointItems(includeArchived = false): Promise<PointItem[]> {
  const sb = getServerSupabase();
  let query = sb.from('point_items').select('id, label, points, kind, discretionary, archived, sort_order, max_per_term, auto_trigger').order('sort_order');
  if (!includeArchived) query = query.eq('archived', false);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id, label: r.label, points: r.points, kind: r.kind, discretionary: r.discretionary,
    archived: r.archived, sortOrder: r.sort_order, maxPerTerm: r.max_per_term, autoTrigger: r.auto_trigger,
  }));
}

export async function getPointEntries(): Promise<PointEntry[]> {
  const sb = getServerSupabase();
  const { data, error } = await sb
    .from('points_entries')
    .select('id, member_id, item_id, points, logged_by, term_id, meeting_id, created_at, point_items(label)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id, memberId: r.member_id, itemId: r.item_id, label: r.point_items?.label ?? '(item)',
    points: r.points, loggedBy: r.logged_by, termId: r.term_id, meetingId: r.meeting_id, createdAt: r.created_at,
  }));
}

export async function getSettings(): Promise<ScoreConfig> {
  const sb = getServerSupabase();
  const { data, error } = await sb.from('settings').select('points_floor, points_ceiling').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message);
  return { floor: data?.points_floor ?? -5, ceiling: data?.points_ceiling ?? null };
}

export async function getCurrentTerm(): Promise<Term | null> {
  const sb = getServerSupabase();
  const { data, error } = await sb.from('terms').select('id, label, is_current').eq('is_current', true).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { id: data.id, label: data.label, isCurrent: data.is_current } : null;
}

export async function getTerms(): Promise<Term[]> {
  const sb = getServerSupabase();
  const { data, error } = await sb.from('terms').select('id, label, is_current').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ id: r.id, label: r.label, isCurrent: r.is_current }));
}

export async function getMeetings(): Promise<MeetingRow[]> {
  const sb = getServerSupabase();
  const { data, error } = await sb.from('meetings').select('id, title, held_on, term_id').order('held_on', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ id: r.id, title: r.title, heldOn: r.held_on, termId: r.term_id }));
}

export async function getAttendanceForMeeting(meetingId: string): Promise<Record<string, AttendanceState>> {
  const sb = getServerSupabase();
  const { data, error } = await sb.from('attendance').select('member_id, state').eq('meeting_id', meetingId);
  if (error) throw new Error(error.message);
  const out: Record<string, AttendanceState> = {};
  (data ?? []).forEach((r: any) => { out[r.member_id] = r.state; });
  return out;
}

// Every member's attendance states across all meetings, for the standings'
// attendance% column. Order doesn't matter to attendancePctFrom (a present/
// absent ratio), so no held_on ordering is needed here.
export async function getAllAttendance(): Promise<Record<string, AttendanceState[]>> {
  const sb = getServerSupabase();
  const { data, error } = await sb.from('attendance').select('member_id, state');
  if (error) throw new Error(error.message);
  const out: Record<string, AttendanceState[]> = {};
  (data ?? []).forEach((r: any) => {
    (out[r.member_id] ??= []).push(r.state);
  });
  return out;
}

export async function getTermStatuses(termId: string): Promise<MemberTermStatus[]> {
  const sb = getServerSupabase();
  const { data, error } = await sb.from('member_term_statuses').select('member_id, kind, reason').eq('term_id', termId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ memberId: r.member_id, kind: r.kind, reason: r.reason }));
}
