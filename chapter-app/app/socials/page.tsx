import { getEvents, getMembers, getEventRsvps, getMyMembershipId } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { SocialsScreen } from '@/components/SocialsScreen';

// Server component: fetch events + roster + RSVPs, hand to the role-aware screen.
// SocialsScreen filters to social/brotherhood events; exec creates/edits, members
// RSVP (both persist via server actions). Attendance/check-in lives on its own tab.
export default async function SocialsPage() {
  const [events, members, rsvps, myMembershipId] = await Promise.all([
    getEvents(), getMembers(), getEventRsvps(), getMyMembershipId(),
  ]);
  return (
    <SocialsScreen
      events={events}
      members={members}
      rsvps={rsvps}
      myMembershipId={myMembershipId}
      live={isSupabaseConfigured}
    />
  );
}
