// Resolve the signed-in user to their chapter membership — the identity join
// (auth user → profile → membership) that every self-writable action and the
// topbar identity need. `resolveIdentity` runs that join ONCE per request
// (React `cache()`): the layout's getCurrentUser, the layout's + each page's
// getMyMembershipId, and any server action all share the same two queries
// instead of each firing their own. The thin wrappers below expose it in the
// shapes callers already use — `resolveMembershipId` returns null for read
// paths that degrade gracefully; `requireMembershipId` throws the user-facing
// messages the server actions surface.
import { cache } from 'react';
import { getServerSupabase, getSessionUser } from './supabase/server';

type ServerSupabase = ReturnType<typeof getServerSupabase>;

export type Identity = {
  // false when signed in but not yet on the roster (no matching profile row).
  onRoster: boolean;
  email: string | null;
  profileId: string | null;
  membershipId: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  position: string | null;
  accessRole: 'admin' | 'exec' | 'member' | null;
  status: 'active' | 'new' | 'inactive' | null;
};

// null when not signed in. Deduped per request so the auth round-trip + the two
// lookups happen at most once even though several callers ask for identity.
export const resolveIdentity = cache(async (): Promise<Identity | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const sb = getServerSupabase();

  // Look up by auth_user_id (exact, indexed — what RLS itself matches on).
  const { data: prof } = await sb
    .from('profiles')
    .select('id, full_name, avatar_url')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!prof) {
    return {
      onRoster: false, email: user.email ?? null, profileId: null, membershipId: null,
      fullName: null, avatarUrl: null, position: null, accessRole: null, status: null,
    };
  }

  const { data: mem } = await sb
    .from('memberships')
    .select('id, position, access_role, status')
    .eq('profile_id', prof.id)
    .maybeSingle();

  return {
    onRoster: true,
    email: user.email ?? null,
    profileId: prof.id,
    membershipId: mem?.id ?? null,
    fullName: prof.full_name,
    avatarUrl: prof.avatar_url ?? null,
    position: mem?.position ?? null,
    accessRole: (mem?.access_role as Identity['accessRole']) ?? null,
    status: (mem?.status as Identity['status']) ?? null,
  };
});

// null when not signed in / no profile / not on the roster. The `sb` param is
// kept for call-site compatibility; identity resolution uses the cached client.
export async function resolveMembershipId(_sb?: ServerSupabase): Promise<string | null> {
  const id = await resolveIdentity();
  return id?.membershipId ?? null;
}

// Same lookup, but throws — distinguishing "not signed in" from "not on roster".
export async function requireMembershipId(_sb?: ServerSupabase): Promise<string> {
  const id = await resolveIdentity();
  if (!id) throw new Error('Not signed in');
  if (!id.membershipId) throw new Error('You’re not on the roster');
  return id.membershipId;
}
