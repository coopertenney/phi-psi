'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getServerSupabase } from '@/lib/supabase/server';
import type { AttendanceState, TermStatusKind } from '@/lib/types';

type ServerSupabase = ReturnType<typeof getServerSupabase>;

async function currentTermId(sb: ServerSupabase): Promise<string> {
  const { data } = await sb.from('terms').select('id').eq('is_current', true).maybeSingle();
  if (!data) throw new Error('No current term is set. Start one from the catalog page first.');
  return data.id;
}

async function signedInExecName(sb: ServerSupabase): Promise<string> {
  const { data: { user } } = await sb.auth.getUser();
  return user?.email ?? 'Exec';
}

// Enforce an item's per-term cap before an insert. No cap or no term → no-op.
async function assertUnderCap(sb: ServerSupabase, memberId: string, itemId: string, termId: string) {
  const { data: item } = await sb.from('point_items').select('max_per_term, label').eq('id', itemId).maybeSingle();
  const cap = item?.max_per_term as number | null | undefined;
  if (!cap) return;
  const { count } = await sb.from('points_entries')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', memberId).eq('item_id', itemId).eq('term_id', termId);
  if ((count ?? 0) >= cap) throw new Error(`"${item?.label ?? 'This item'}" is capped at ${cap} per term.`);
}

/* ─────────────────────────── Members ─────────────────────────── */

export async function addMember(name: string) {
  const sb = getServerSupabase();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Name is required.');
  const { error } = await sb.from('members').insert({ name: trimmed });
  if (error) throw new Error(error.message);
  revalidatePath('/admin');
  revalidatePath('/admin/attendance');
  revalidatePath('/board');
}

/* ─────────────────────────── Points ─────────────────────────── */

// Always lands counted immediately — there is no member self-log/request
// queue in this app, so every entry is exec-logged and approved by construction.
export async function logPoints(memberId: string, itemId: string, points: number) {
  const sb = getServerSupabase();
  const termId = await currentTermId(sb);
  await assertUnderCap(sb, memberId, itemId, termId);
  const loggedBy = await signedInExecName(sb);
  const { error } = await sb.from('points_entries').insert({
    member_id: memberId,
    item_id: itemId,
    points,
    logged_by: loggedBy,
    term_id: termId,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/admin');
  revalidatePath('/board');
}

// Form wrapper: item's catalog value is used unless the item is discretionary,
// in which case the exec-entered "points" field (signed by the item's kind) is used.
export async function logPointsForm(formData: FormData) {
  const sb = getServerSupabase();
  const memberId = String(formData.get('memberId') ?? '');
  const itemId = String(formData.get('itemId') ?? '');
  if (!memberId || !itemId) throw new Error('Pick a member and an item.');
  const { data: item, error } = await sb.from('point_items').select('points, kind, discretionary').eq('id', itemId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!item) throw new Error('Item not found.');
  let points = item.points as number;
  if (item.discretionary) {
    const raw = Math.abs(Number(formData.get('discretionaryPoints') ?? 0));
    points = item.kind === 'punishment' ? -raw : raw;
  }
  await logPoints(memberId, itemId, points);
}

export async function addMemberForm(formData: FormData) {
  await addMember(String(formData.get('name') ?? ''));
}

/* ─────────────────────────── Catalog ─────────────────────────── */

export interface PointItemPatch {
  label?: string;
  points?: number;
  kind?: 'reward' | 'punishment';
  discretionary?: boolean;
  maxPerTerm?: number | null;
  autoTrigger?: AttendanceState | null;
}

export async function createPointItem(
  input: { label: string; points: number; kind: 'reward' | 'punishment'; discretionary: boolean },
): Promise<{ id: string }> {
  const sb = getServerSupabase();
  const { data: max } = await sb.from('point_items').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();
  const sortOrder = ((max?.sort_order as number | undefined) ?? 0) + 1;
  const { data, error } = await sb.from('point_items').insert({
    label: input.label.trim(),
    points: input.discretionary ? 0 : input.points,
    kind: input.kind,
    discretionary: input.discretionary,
    sort_order: sortOrder,
  }).select('id').single();
  if (error) throw new Error(error.message);
  revalidatePath('/admin/catalog');
  revalidatePath('/admin');
  return { id: data.id };
}

export async function updatePointItem(itemId: string, patch: PointItemPatch) {
  const sb = getServerSupabase();
  const db: Record<string, unknown> = {};
  if (patch.label !== undefined) db.label = patch.label;
  if (patch.points !== undefined) db.points = patch.points;
  if (patch.kind !== undefined) db.kind = patch.kind;
  if (patch.discretionary !== undefined) db.discretionary = patch.discretionary;
  if (patch.maxPerTerm !== undefined) db.max_per_term = patch.maxPerTerm;
  if (patch.autoTrigger !== undefined) db.auto_trigger = patch.autoTrigger;
  const { error } = await sb.from('point_items').update(db).eq('id', itemId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/catalog');
  revalidatePath('/admin');
}

// Soft-delete / restore. Archived items drop out of the Log-points picker but
// stay joinable, so past ledger rows keep their real label.
export async function archivePointItem(itemId: string, archived: boolean) {
  const sb = getServerSupabase();
  const { error } = await sb.from('point_items').update({ archived }).eq('id', itemId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/catalog');
  revalidatePath('/admin');
}

export async function updateSettings(patch: { floor?: number; ceiling?: number | null }) {
  const sb = getServerSupabase();
  const db: Record<string, unknown> = {};
  if (patch.floor !== undefined) db.points_floor = patch.floor;
  if (patch.ceiling !== undefined) db.points_ceiling = patch.ceiling;
  const { error } = await sb.from('settings').update(db).eq('id', 1);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/catalog');
  revalidatePath('/admin');
  revalidatePath('/board');
}

// Ends the current term and starts a new one. There is no reset-each-term
// logic — this only changes which term_id new entries/caps scope to.
export async function startNewTerm(label: string) {
  const sb = getServerSupabase();
  const trimmed = label.trim();
  if (!trimmed) throw new Error('Term label is required.');
  const { error: clearErr } = await sb.from('terms').update({ is_current: false }).eq('is_current', true);
  if (clearErr) throw new Error(clearErr.message);
  const { error } = await sb.from('terms').insert({ label: trimmed, is_current: true });
  if (error) throw new Error(error.message);
  revalidatePath('/admin/catalog');
  revalidatePath('/admin/attendance');
}

/* ─────────────────────────── Attendance ─────────────────────────── */

export interface AttendanceInput {
  meetingId: string | null; // null → create a new meeting from title/heldOn
  title: string;
  heldOn: string;           // ISO date
  entries: { memberId: string; state: AttendanceState }[];
}

export async function recordAttendance(input: AttendanceInput): Promise<string> {
  const sb = getServerSupabase();
  let meetingId: string;
  if (input.meetingId) {
    meetingId = input.meetingId;
  } else {
    const termId = await currentTermId(sb);
    const { data, error } = await sb.from('meetings')
      .insert({ title: input.title.trim() || 'Chapter meeting', held_on: input.heldOn, term_id: termId })
      .select('id').single();
    if (error) throw new Error(error.message);
    meetingId = data.id;
  }
  if (input.entries.length) {
    const rows = input.entries.map((e) => ({ meeting_id: meetingId, member_id: e.memberId, state: e.state }));
    const { error } = await sb.from('attendance').upsert(rows, { onConflict: 'meeting_id,member_id' });
    if (error) throw new Error(error.message);
  }
  await applyAutoAwards(sb, meetingId, input.entries);
  revalidatePath('/admin/attendance');
  revalidatePath('/admin');
  revalidatePath('/board');
  return meetingId;
}

// Auto-award: an item with auto_trigger is awarded automatically when a member
// is recorded in that state, and is hidden from the manual Log-points picker
// (no double-counting). Idempotent per meeting: clears this meeting's auto
// entries first, then re-derives from the states just saved.
async function applyAutoAwards(
  sb: ServerSupabase, meetingId: string, entries: { memberId: string; state: AttendanceState }[],
) {
  const { data: autos, error: aErr } = await sb
    .from('point_items').select('id, points, auto_trigger')
    .eq('archived', false).not('auto_trigger', 'is', null);
  if (aErr) throw new Error(aErr.message);
  const autoItems = autos ?? [];
  if (!autoItems.length) return;

  const { error: delErr } = await sb.from('points_entries').delete()
    .eq('meeting_id', meetingId).in('item_id', autoItems.map((i: any) => i.id));
  if (delErr) throw new Error(delErr.message);

  const termId = await currentTermId(sb);
  const loggedBy = await signedInExecName(sb);
  const rows = entries.flatMap((e) =>
    autoItems.filter((it: any) => it.auto_trigger === e.state).map((it: any) => ({
      member_id: e.memberId, item_id: it.id, points: it.points,
      logged_by: `Auto (attendance, ${loggedBy})`, meeting_id: meetingId, term_id: termId,
    })),
  );
  if (rows.length) {
    const { error } = await sb.from('points_entries').insert(rows);
    if (error) throw new Error(error.message);
  }
}

// Set/replace a member's standing status for the current term (abroad / recurring excuse).
export async function setTermStatus(memberId: string, kind: TermStatusKind, reason: string) {
  const sb = getServerSupabase();
  const termId = await currentTermId(sb);
  const { error } = await sb.from('member_term_statuses').upsert(
    { member_id: memberId, term_id: termId, kind, reason: reason.trim() || null },
    { onConflict: 'member_id,term_id' },
  );
  if (error) throw new Error(error.message);
  revalidatePath('/admin/attendance');
}

export async function clearTermStatus(memberId: string) {
  const sb = getServerSupabase();
  const termId = await currentTermId(sb);
  const { error } = await sb.from('member_term_statuses').delete().eq('member_id', memberId).eq('term_id', termId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/attendance');
}

/* ─────────────────────────── Auth ─────────────────────────── */

export async function signOut() {
  const sb = getServerSupabase();
  await sb.auth.signOut();
  redirect('/login');
}
