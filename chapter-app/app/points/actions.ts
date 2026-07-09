'use server';

import { getServerSupabase } from '@/lib/supabase/server';
import { requireMembershipId } from '@/lib/membership';
import { CHAPTER_ID } from '@/lib/chapter';
import type { AttendanceState, TermStatusKind } from '@/lib/types';

// The chapter's current term id, or null if none is set. Non-throwing (unlike
// currentTermId below) so logging still works before a term is configured —
// term-scoped rules (caps / reset) simply don't apply until one exists.
async function currentTermIdOrNull(sb: ReturnType<typeof getServerSupabase>): Promise<string | null> {
  const { data } = await sb.from('terms').select('id').eq('chapter_id', CHAPTER_ID).eq('is_current', true).maybeSingle();
  return data?.id ?? null;
}

// Enforce an item's per-term cap before an insert. Counts the member's existing
// entries (approved + pending, so requests can't overshoot the cap) for this
// item in the given term. No cap or no term → no-op.
async function assertUnderCap(
  sb: ReturnType<typeof getServerSupabase>, membershipId: string, itemId: string, termId: string | null,
) {
  if (!termId) return;
  const { data: item } = await sb.from('point_items').select('max_per_term, label').eq('id', itemId).maybeSingle();
  const cap = item?.max_per_term as number | null | undefined;
  if (!cap) return;
  const { count } = await sb.from('points_entries')
    .select('id', { count: 'exact', head: true })
    .eq('membership_id', membershipId).eq('item_id', itemId).eq('term_id', termId);
  if ((count ?? 0) >= cap) throw new Error(`"${item?.label ?? 'This item'}" is capped at ${cap} per term.`);
}

// Exec-only — RLS (points_entries_cud) enforces it server-side. `points` is
// passed explicitly rather than re-derived from the item, since discretionary
// items (the sheet's "?" rows) have exec-chosen values with no catalog default.
// Stamps the current term so caps + reset-each-term have a term to scope by.
export async function logPoints(membershipId: string, itemId: string, points: number, approvedBy: string) {
  const sb = getServerSupabase();
  const termId = await currentTermIdOrNull(sb);
  await assertUnderCap(sb, membershipId, itemId, termId);
  const { error } = await sb.from('points_entries').insert({
    membership_id: membershipId,
    item_id: itemId,
    points,
    approved_by: approvedBy,
    status: 'approved',   // exec-logged entries count immediately (vs. member requests)
    term_id: termId,
  });
  if (error) throw new Error(error.message);
}

// Member self-log: a REQUEST, not an award. RLS (points_entries_self_request)
// is the real gate — it allows this only for the caller's own membership, a
// self-loggable non-discretionary item, at the item's catalog value. Normally
// lands 'pending'; an auto_approve item lands 'approved' and counts immediately
// (the RLS policy permits an approved self-insert only for auto_approve items).
export async function requestPoints(membershipId: string, itemId: string, points: number) {
  const sb = getServerSupabase();
  const termId = await currentTermIdOrNull(sb);
  await assertUnderCap(sb, membershipId, itemId, termId);
  const { data: item } = await sb.from('point_items').select('auto_approve').eq('id', itemId).maybeSingle();
  const auto = !!item?.auto_approve;
  const { error } = await sb.from('points_entries').insert({
    membership_id: membershipId,
    item_id: itemId,
    points,
    status: auto ? 'approved' : 'pending',
    approved_by: auto ? 'Auto-approved' : null,
    term_id: termId,
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

// Edit a catalog item. Exec-only — RLS (point_items_cud) enforces it server-side.
// Any edit (value, label, kind, discretionary) changes FUTURE awards only:
// points_entries.points is a snapshot copied at log time, and the ledger reads
// the label off the entry's item join, so past entries and existing totals are
// untouched. Callers pass only the fields they changed.
export interface PointItemPatch {
  label?: string;
  points?: number;
  kind?: 'reward' | 'punishment';
  discretionary?: boolean;
  maxPerTerm?: number | null;                         // per-member cap per term
  autoTrigger?: AttendanceState | null;               // auto-award on attendance state
  selfLoggable?: boolean | null;                      // override self-log eligibility
  autoApprove?: boolean;                              // self-log lands approved
}
export async function updatePointItem(itemId: string, patch: PointItemPatch) {
  const sb = getServerSupabase();
  // Map the camelCase patch to snake_case columns; only touch supplied fields.
  const db: Record<string, unknown> = {};
  if (patch.label !== undefined) db.label = patch.label;
  if (patch.points !== undefined) db.points = patch.points;
  if (patch.kind !== undefined) db.kind = patch.kind;
  if (patch.discretionary !== undefined) db.discretionary = patch.discretionary;
  if (patch.maxPerTerm !== undefined) db.max_per_term = patch.maxPerTerm;
  if (patch.autoTrigger !== undefined) db.auto_trigger = patch.autoTrigger;
  if (patch.selfLoggable !== undefined) db.self_loggable = patch.selfLoggable;
  if (patch.autoApprove !== undefined) db.auto_approve = patch.autoApprove;
  const { error } = await sb.from('point_items').update(db).eq('id', itemId);
  if (error) throw new Error(error.message);
}

// Chapter-wide scoring rules (floor / ceiling / reset-each-term). Exec-only —
// RLS on chapters gates the write, same as the dues-payments toggle.
export interface PointsConfigPatch {
  pointsFloor?: number;
  pointsCeiling?: number | null;
  pointsResetEachTerm?: boolean;
}
export async function updatePointsConfig(patch: PointsConfigPatch) {
  const sb = getServerSupabase();
  const db: Record<string, unknown> = {};
  if (patch.pointsFloor !== undefined) db.points_floor = patch.pointsFloor;
  if (patch.pointsCeiling !== undefined) db.points_ceiling = patch.pointsCeiling;
  if (patch.pointsResetEachTerm !== undefined) db.points_reset_each_term = patch.pointsResetEachTerm;
  const { error } = await sb.from('chapters').update(db).eq('id', CHAPTER_ID);
  if (error) throw new Error(error.message);
}

// Add a new catalog item. Exec-only via RLS. Appends after the current max
// sort_order so it lands at the end of its section. Returns the created row so
// the client can mirror it optimistically.
export async function createPointItem(
  input: { label: string; points: number; kind: 'reward' | 'punishment'; discretionary: boolean },
): Promise<{ id: string; sortOrder: number }> {
  const sb = getServerSupabase();
  const { data: max } = await sb
    .from('point_items').select('sort_order')
    .eq('chapter_id', CHAPTER_ID).order('sort_order', { ascending: false }).limit(1).maybeSingle();
  const sortOrder = ((max?.sort_order as number | undefined) ?? 0) + 1;
  const { data, error } = await sb.from('point_items').insert({
    chapter_id: CHAPTER_ID,
    label: input.label.trim(),
    points: input.discretionary ? 0 : input.points,
    kind: input.kind,
    discretionary: input.discretionary,
    sort_order: sortOrder,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return { id: data.id, sortOrder };
}

// Soft-delete / restore a catalog item. Exec-only via RLS. Archived items drop
// out of the Log-points and self-log pickers but stay joinable, so past ledger
// rows keep their real label instead of rendering "(deleted item)".
export async function archivePointItem(itemId: string, archived: boolean) {
  const sb = getServerSupabase();
  const { error } = await sb.from('point_items').update({ archived }).eq('id', itemId);
  if (error) throw new Error(error.message);
}

// Reorder the catalog. Exec-only via RLS. Takes only the rows whose position
// changed (a neighbor swap = two rows), each with its new sort_order.
export async function reorderPointItems(updates: { id: string; sortOrder: number }[]) {
  const sb = getServerSupabase();
  await Promise.all(
    updates.map(({ id, sortOrder }) =>
      sb.from('point_items').update({ sort_order: sortOrder }).eq('id', id).then(({ error }) => {
        if (error) throw new Error(error.message);
      }),
    ),
  );
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
  await applyAutoAwards(sb, meetingId, input.entries);
  return meetingId;
}

// Auto-award (option C): items with an `auto_trigger` are owned by attendance —
// when a member is recorded in the trigger state, the item is awarded
// automatically (and it's hidden from the manual Log-points picker, so there's
// no double-counting). Idempotent per meeting: every re-save first clears this
// meeting's auto entries, then re-derives them from the states just saved.
async function applyAutoAwards(
  sb: ServerSupabase, meetingId: string, entries: { membershipId: string; state: AttendanceState }[],
) {
  const { data: autos, error: aErr } = await sb
    .from('point_items').select('id, points, auto_trigger')
    .eq('chapter_id', CHAPTER_ID).eq('archived', false).not('auto_trigger', 'is', null);
  if (aErr) throw new Error(aErr.message);
  const autoItems = autos ?? [];
  if (!autoItems.length) return;

  const { error: delErr } = await sb
    .from('points_entries').delete().eq('meeting_id', meetingId)
    .in('item_id', autoItems.map((i: any) => i.id));
  if (delErr) throw new Error(delErr.message);

  const termId = await currentTermIdOrNull(sb);
  const rows = entries.flatMap((e) =>
    autoItems
      .filter((it: any) => it.auto_trigger === e.state)
      .map((it: any) => ({
        membership_id: e.membershipId, item_id: it.id, points: it.points,
        status: 'approved', approved_by: 'Auto (attendance)', meeting_id: meetingId, term_id: termId,
      })),
  );
  if (rows.length) {
    const { error } = await sb.from('points_entries').insert(rows);
    if (error) throw new Error(error.message);
  }
}

// Schedule a recurring series of chapter meetings in one shot. Skips any dates
// that already have a meeting for this chapter — `meetings` has no unique on
// (chapter_id, held_on), only an index, so re-running the scheduler (or
// overlapping a meeting already created via Take attendance / check-in) would
// otherwise silently double-create. Returns the freshly-created rows so the
// client can add them optimistically. Exec-only via the meetings RLS.
export async function scheduleMeetings(
  input: { title: string; dates: string[] },
): Promise<{ id: string; title: string; date: string }[]> {
  const sb = getServerSupabase();
  const title = input.title.trim() || 'Chapter meeting';
  const wanted = [...new Set(input.dates.map((d) => d.slice(0, 10)))].filter(Boolean).sort();
  if (!wanted.length) return [];

  const term_id = await currentTermId(sb);

  // Which of the requested dates already exist? Bounded query over the range.
  const { data: existing, error: exErr } = await sb
    .from('meetings')
    .select('held_on')
    .eq('chapter_id', CHAPTER_ID)
    .gte('held_on', wanted[0])
    .lte('held_on', wanted[wanted.length - 1]);
  if (exErr) throw new Error(exErr.message);
  const taken = new Set((existing ?? []).map((r: any) => String(r.held_on).slice(0, 10)));

  const fresh = wanted.filter((d) => !taken.has(d));
  if (!fresh.length) return [];

  const { data, error } = await sb
    .from('meetings')
    .insert(fresh.map((held_on) => ({ chapter_id: CHAPTER_ID, term_id, title, held_on })))
    .select('id, title, held_on');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({ id: r.id, title: r.title, date: r.held_on }));
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
