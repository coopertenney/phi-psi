import { getMembers, getStats, getChapterSettings, getMyMembershipId } from '@/lib/data';
import { getRecentPayments } from '@/lib/data/payments';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { FinancesScreen } from '@/components/FinancesScreen';
import { confirmCheckoutOnReturn } from './actions';

// Server component: fetch on the server (mock now, Supabase once configured),
// hand data to the role-aware client screen. Exec sees the full dues ledger;
// a member sees only their own — their real membership in live mode (gated by
// RLS), or the persona toggle's stand-in in mock/demo mode.
export default async function FinancesPage({
  searchParams,
}: {
  searchParams: Promise<{ paid?: string; session_id?: string }>;
}) {
  // Returning from Stripe Checkout? Verify + record the payment BEFORE fetching,
  // so the balance below already reflects it (no flash of "due" then a flip).
  const { paid, session_id } = await searchParams;
  if (paid && session_id) await confirmCheckoutOnReturn(session_id);

  const [members, stats, settings, myMembershipId, recentPayments] = await Promise.all([
    getMembers(), getStats(), getChapterSettings(), getMyMembershipId(), getRecentPayments(),
  ]);
  return (
    <FinancesScreen
      members={members}
      stats={stats}
      settings={settings}
      myMembershipId={myMembershipId}
      recentPayments={recentPayments}
      live={isSupabaseConfigured}
    />
  );
}
