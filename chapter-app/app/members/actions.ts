'use server';

import { revalidatePath } from 'next/cache';
import { getServerSupabase } from '@/lib/supabase/server';
import { PRESIDENT_OFFICE, type ExecAssignment } from '@/lib/nav';

// Appoint a new executive board — succession, not additive. Admin-only (the
// outgoing President). The incoming President is granted admin access; other
// officers get exec + their title; and any current officer NOT in the new slate
// is demoted back to a plain member. RLS is the real gate: the
// `roster_admin_update` policy in schema.sql restricts memberships UPDATE to a
// chapter admin (the guard below is a friendlier fail-fast pre-check).
export async function appointExec(assignments: ExecAssignment[]) {
  const sb = getServerSupabase();

  // Guard: caller must be an admin on their chapter.
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Not signed in.');
  const { data: prof } = await sb.from('profiles').select('id').eq('auth_user_id', user.id).maybeSingle();
  if (!prof) throw new Error('No profile on file.');
  const { data: mine } = await sb
    .from('memberships').select('id, chapter_id, access_role').eq('profile_id', prof.id).maybeSingle();
  if (!mine || mine.access_role !== 'admin') {
    throw new Error('Only the President (admin) can appoint the executive board.');
  }
  const chapterId = mine.chapter_id as string;
  const selfId = mine.id as string;

  const slateIds = new Set(assignments.map((a) => a.membershipId));

  // 1) Grant the new slate FIRST, so the incoming President holds admin before we
  //    demote anyone (including, possibly, the outgoing President running this).
  for (const a of assignments) {
    const isPres = a.office === PRESIDENT_OFFICE;
    const { error } = await sb.from('memberships')
      .update({ access_role: isPres ? 'admin' : 'exec', position: a.office })
      .eq('id', a.membershipId).eq('chapter_id', chapterId);
    if (error) throw new Error(error.message);
  }

  // 2) Demote current officers who aren't in the new slate. Do the caller's own
  //    row LAST so their admin rights survive long enough to finish the batch.
  const { data: current } = await sb.from('memberships')
    .select('id')
    .eq('chapter_id', chapterId)
    .or('access_role.in.(exec,admin),position.not.is.null');
  const toDemote = (current ?? [])
    .map((m: any) => m.id as string)
    .filter((id) => !slateIds.has(id))
    .sort((a, b) => (a === selfId ? 1 : 0) - (b === selfId ? 1 : 0));
  for (const id of toDemote) {
    const { error } = await sb.from('memberships')
      .update({ access_role: 'member', position: null })
      .eq('id', id).eq('chapter_id', chapterId);
    if (error) throw new Error(error.message);
  }

  // Refresh every screen — roster, sidebar identity, and access all key off roles.
  revalidatePath('/', 'layout');
}
