import { getMembers, getMyMembershipId } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { ProfileScreen } from '@/components/ProfileScreen';

// The signed-in member's own profile page. Photo upload + standing + contact +
// lineage. Resolves identity from the roster (by membership id when live).
export default async function ProfilePage() {
  const [members, myMembershipId] = await Promise.all([getMembers(), getMyMembershipId()]);
  return <ProfileScreen members={members} myMembershipId={myMembershipId} live={isSupabaseConfigured} />;
}
