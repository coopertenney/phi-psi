import { getEvents, getMembers, getEventRsvps, getMyMembershipId } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { EventsScreen } from '@/components/EventsScreen';

// Server component: fetch events + roster + RSVPs, hand to the role-aware screen.
// Exec creates/edits events; a member RSVPs (both persist via server actions).
export default async function EventsPage() {
  const [events, members, rsvps, myMembershipId] = await Promise.all([
    getEvents(), getMembers(), getEventRsvps(), getMyMembershipId(),
  ]);
  return (
    <EventsScreen
      events={events}
      members={members}
      rsvps={rsvps}
      myMembershipId={myMembershipId}
      live={isSupabaseConfigured}
    />
  );
}
