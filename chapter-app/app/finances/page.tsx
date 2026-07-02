import { getMembers, getStats, getChapterSettings } from '@/lib/data';
import { FinancesScreen } from '@/components/FinancesScreen';

// Server component: fetch on the server (mock now, Supabase once configured),
// hand data to the role-aware client screen. Exec sees the full dues ledger;
// a member sees only their own (gated client-side here, by RLS in live mode).
export default async function FinancesPage() {
  const [members, stats, settings] = await Promise.all([getMembers(), getStats(), getChapterSettings()]);
  return <FinancesScreen members={members} stats={stats} settings={settings} />;
}
