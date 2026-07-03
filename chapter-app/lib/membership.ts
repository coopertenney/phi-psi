// Resolve the signed-in user to their chapter membership id — the identity join
// (auth user → profile → membership) that every self-writable action needs.
// Two variants share the profile→membership half: `resolveMembershipId` returns
// null for read paths that degrade gracefully; `requireMembershipId` throws the
// user-facing messages the server actions surface.
import type { getServerSupabase } from './supabase/server';

type ServerSupabase = ReturnType<typeof getServerSupabase>;

async function membershipIdForAuthUser(sb: ServerSupabase, authUserId: string): Promise<string | null> {
  const { data: prof } = await sb.from('profiles').select('id').eq('auth_user_id', authUserId).maybeSingle();
  if (!prof) return null;
  const { data: mem } = await sb.from('memberships').select('id').eq('profile_id', prof.id).maybeSingle();
  return mem?.id ?? null;
}

// null when not signed in / no profile / not on the roster.
export async function resolveMembershipId(sb: ServerSupabase): Promise<string | null> {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  return membershipIdForAuthUser(sb, user.id);
}

// Same lookup, but throws — distinguishing "not signed in" from "not on roster".
export async function requireMembershipId(sb: ServerSupabase): Promise<string> {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Not signed in');
  const id = await membershipIdForAuthUser(sb, user.id);
  if (!id) throw new Error('You’re not on the roster');
  return id;
}
