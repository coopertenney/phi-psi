import { getMembers, getPointEntries, getPointItems, getMeetings, getAttendance, getMemberTermStatuses, getMyMembershipId } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { PointsScreen } from '@/components/PointsScreen';
import { AttendanceScreen } from '@/components/AttendanceScreen';

// Combined accountability tab: points leaderboard + meeting attendance, side by
// side on wide screens (stacks on mobile). Each half stays its own self-contained
// screen — this page only fetches the union of their data and lays them out.
// myMembershipId lets each half resolve the signed-in member in live mode (the
// persona-name lookup only works on mock data).
export default async function PointsPage() {
  const [members, entries, items, meetings, attendance, termStatuses, myMembershipId] = await Promise.all([
    getMembers(), getPointEntries(), getPointItems(), getMeetings(), getAttendance(), getMemberTermStatuses(), getMyMembershipId(),
  ]);
  return (
    <div className="pkp-pa-grid">
      <div className="pkp-pa-col">
        <PointsScreen members={members} entries={entries} items={items} live={isSupabaseConfigured} myMembershipId={myMembershipId} />
      </div>
      <div className="pkp-pa-col">
        <AttendanceScreen members={members} meetings={meetings} attendance={attendance} memberTermStatuses={termStatuses} myMembershipId={myMembershipId} live={isSupabaseConfigured} />
      </div>
    </div>
  );
}
