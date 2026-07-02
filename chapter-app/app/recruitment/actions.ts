'use server';

import { getServerSupabase } from '@/lib/supabase/server';
import type { PnmStage } from '@/lib/types';

const CHAPTER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

// The signed-in member's own membership id, for self-writable rows
// (rating/vote/note). Throws if they're not on the roster.
async function myMembershipId(sb: ReturnType<typeof getServerSupabase>): Promise<string> {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const { data: prof } = await sb.from('profiles').select('id').eq('auth_user_id', user.id).maybeSingle();
  const { data: mem } = prof
    ? await sb.from('memberships').select('id').eq('profile_id', prof.id).maybeSingle()
    : { data: null };
  if (!mem) throw new Error('You’re not on the roster');
  return mem.id;
}

export interface PnmInput {
  fullName: string;
  standing: string;
  major: string;
  email: string;
  phone: string;
  referredBy: string | null;
  stage: PnmStage;
}

// Exec-only — RLS (pnms_cud) enforces it server-side.
export async function createPnm(input: PnmInput) {
  const sb = getServerSupabase();
  const { error } = await sb.from('pnms').insert({
    chapter_id: CHAPTER_ID,
    full_name: input.fullName,
    standing: input.standing,
    major: input.major,
    email: input.email,
    phone: input.phone,
    referred_by: input.referredBy,
    stage: input.stage,
  });
  if (error) throw new Error(error.message);
}

// Exec-only stage move (advance / bid / accept / decline / reopen).
export async function setPnmStage(id: string, stage: PnmStage) {
  const sb = getServerSupabase();
  const { error } = await sb.from('pnms').update({ stage }).eq('id', id);
  if (error) throw new Error(error.message);
}

// Self-writable — RLS (pnm_ratings_mine) ensures a brother can only write their
// own rating. 0 clears (removes) the rating, matching the star-toggle UI.
export async function ratePnm(pnmId: string, rating: number) {
  const sb = getServerSupabase();
  const membershipId = await myMembershipId(sb);
  if (rating <= 0) {
    const { error } = await sb.from('pnm_ratings').delete().eq('pnm_id', pnmId).eq('membership_id', membershipId);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await sb
    .from('pnm_ratings')
    .upsert({ pnm_id: pnmId, membership_id: membershipId, rating }, { onConflict: 'pnm_id,membership_id' });
  if (error) throw new Error(error.message);
}

// Self-writable — RLS (pnm_votes_mine). null clears the vote (toggle off).
export async function votePnm(pnmId: string, vote: 'yes' | 'no' | null) {
  const sb = getServerSupabase();
  const membershipId = await myMembershipId(sb);
  if (vote === null) {
    const { error } = await sb.from('pnm_votes').delete().eq('pnm_id', pnmId).eq('membership_id', membershipId);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await sb
    .from('pnm_votes')
    .upsert({ pnm_id: pnmId, membership_id: membershipId, vote }, { onConflict: 'pnm_id,membership_id' });
  if (error) throw new Error(error.message);
}

// Any brother can add a note — RLS (pnm_notes_insert) still pins the author to
// their own membership id server-side.
export async function addPnmNote(pnmId: string, text: string) {
  const sb = getServerSupabase();
  const membershipId = await myMembershipId(sb);
  const { error } = await sb.from('pnm_notes').insert({ pnm_id: pnmId, membership_id: membershipId, body: text });
  if (error) throw new Error(error.message);
}
