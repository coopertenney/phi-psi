import { getMembers, getStats, getChapterSettings, getMyMembershipId } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { FinancesScreen } from '@/components/FinancesScreen';

// Server component: fetch on the server (mock now, Supabase once configured),
// hand data to the role-aware client screen. Exec sees the full dues ledger;
// a member sees only their own — their real membership in live mode (gated by
// RLS), or the persona toggle's stand-in in mock/demo mode.
export default async function FinancesPage() {
  const [members, stats, settings, myMembershipId] = await Promise.all([
    getMembers(), getStats(), getChapterSettings(), getMyMembershipId(),
  ]);
  return (
    <FinancesScreen
      members={members}
      stats={stats}
      settings={settings}
      myMembershipId={myMembershipId}
      live={isSupabaseConfigured}
    />
  );
}
