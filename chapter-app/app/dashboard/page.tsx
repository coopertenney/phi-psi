import { getMembers, getStats, getEvents, getAnnouncements, getMyMembershipId } from '@/lib/data';
import { DashboardScreen } from '@/components/DashboardScreen';

// Server component: fetch chapter data, hand to the role-aware client screen.
// Exec sees the officer dashboard (stats, upcoming events, leaderboard, feed,
// accountability); a member sees their own dues + standing front and center.
// myMembershipId resolves the signed-in member in live mode.
export default async function DashboardPage() {
  const [members, stats, events, announcements, myMembershipId] = await Promise.all([
    getMembers(), getStats(), getEvents(), getAnnouncements(), getMyMembershipId(),
  ]);
  return <DashboardScreen members={members} stats={stats} events={events} announcements={announcements} myMembershipId={myMembershipId} />;
}
