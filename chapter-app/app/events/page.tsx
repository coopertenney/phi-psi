import { getEvents, getMembers, getEventRsvps, getMyMembershipId, getEventCheckins } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { EventsScreen } from '@/components/EventsScreen';

// Server component: fetch events + roster + RSVPs, hand to the role-aware screen.
// Exec creates/edits events + checks members in; a member RSVPs (all persist
// via server actions).
export default async function EventsPage() {
  const [events, members, rsvps, myMembershipId, checkins] = await Promise.all([
    getEvents(), getMembers(), getEventRsvps(), getMyMembershipId(), getEventCheckins(),
  ]);
  return (
    <EventsScreen
      events={events}
      members={members}
      rsvps={rsvps}
      myMembershipId={myMembershipId}
      live={isSupabaseConfigured}
      checkins={checkins}
    />
  );
}
