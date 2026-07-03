'use server';

import { getServerSupabase } from '@/lib/supabase/server';

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
