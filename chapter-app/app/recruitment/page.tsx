import { redirect } from 'next/navigation';
import { getPnms, getPnmNotes, getMyPnmChoices, getCurrentUser } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { RecruitmentScreen } from '@/components/RecruitmentScreen';

// Server component: fetch the PNM pipeline, hand to the role-aware client screen.
// Exec (recruitment chair) manages the funnel and stage transitions; a brother
// rates, votes, and leaves notes on the PNMs being rushed (all persist via
// server actions in live mode).
export default async function RecruitmentPage() {
  // New members are gated out of Recruitment — the sidebar hides the tab, and
  // this guards direct URL access (RLS alone would let any chapter member read
  // PNMs). Execs/admins are never "new", so this only ever redirects pledges.
  const me = await getCurrentUser().catch(() => null);
  if (me?.status === 'new' && me.accessRole !== 'exec' && me.accessRole !== 'admin') redirect('/dashboard');

  const [pnms, notesByPnm, mine] = await Promise.all([getPnms(), getPnmNotes(), getMyPnmChoices()]);
  return (
    <RecruitmentScreen
      pnms={pnms}
      live={isSupabaseConfigured}
      notesByPnm={notesByPnm}
      myRatings={mine.ratings}
      myVotes={mine.votes}
    />
  );
}
