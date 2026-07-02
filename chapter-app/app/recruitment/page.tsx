import { getPnms, getPnmNotes, getMyPnmChoices } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { RecruitmentScreen } from '@/components/RecruitmentScreen';

// Server component: fetch the PNM pipeline, hand to the role-aware client screen.
// Exec (recruitment chair) manages the funnel and stage transitions; a brother
// rates, votes, and leaves notes on the PNMs being rushed (all persist via
// server actions in live mode).
export default async function RecruitmentPage() {
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
