import { getMembers, getStats, getEvents, getAnnouncements, getMyMembershipId, getMyAnnouncementReads } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { DashboardScreen } from '@/components/DashboardScreen';

// Server component: fetch chapter data, hand to the role-aware client screen.
// Exec sees the officer dashboard (stats, upcoming events, leaderboard, feed);
// a member sees their own dues + standing front and center. myMembershipId
// resolves the signed-in member in live mode; myReadIds seeds which
// announcements are already read so the dashboard feed can auto-mark the rest.
export default async function DashboardPage() {
  const [members, stats, events, announcements, myMembershipId, myReadIds] = await Promise.all([
    getMembers(), getStats(), getEvents(), getAnnouncements(), getMyMembershipId(), getMyAnnouncementReads(),
  ]);
  return (
    <DashboardScreen
      members={members} stats={stats} events={events} announcements={announcements}
      myMembershipId={myMembershipId} myReadIds={myReadIds} live={isSupabaseConfigured}
    />
  );
}
