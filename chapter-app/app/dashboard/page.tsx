import { getMembers, getStats, getEvents, getAnnouncements } from '@/lib/data';
import { DashboardScreen } from '@/components/DashboardScreen';

// Server component: fetch chapter data, hand to the role-aware client screen.
// Exec sees the officer dashboard (stats, upcoming events, leaderboard, feed,
// accountability); a member sees their own dues + standing front and center.
export default async function DashboardPage() {
  const [members, stats, events, announcements] = await Promise.all([
    getMembers(), getStats(), getEvents(), getAnnouncements(),
  ]);
  return <DashboardScreen members={members} stats={stats} events={events} announcements={announcements} />;
}
