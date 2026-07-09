import { getEvents, getMembers, getMyMembershipId } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { SocialsScreen } from '@/components/SocialsScreen';

// Server component: fetch events + roster, hand to the role-aware screen.
// SocialsScreen filters to social/brotherhood events; exec creates/edits. RSVPs
// are handled in Partiful (each social links out). Attendance lives on its own tab.
export default async function SocialsPage() {
  const [events, members, myMembershipId] = await Promise.all([
    getEvents(), getMembers(), getMyMembershipId(),
  ]);
  return (
    <SocialsScreen
      events={events}
      members={members}
      myMembershipId={myMembershipId}
      live={isSupabaseConfigured}
    />
  );
}
