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
  });
  if (error) throw new Error(error.message);
}
