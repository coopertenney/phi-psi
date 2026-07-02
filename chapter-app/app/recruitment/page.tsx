import { getPnms } from '@/lib/data';
import { RecruitmentScreen } from '@/components/RecruitmentScreen';

// Server component: fetch the PNM pipeline, hand to the role-aware client screen.
// Exec (recruitment chair) manages the funnel and stage transitions; a brother
// rates, votes, and leaves notes on the PNMs being rushed.
export default async function RecruitmentPage() {
  const pnms = await getPnms();
  return <RecruitmentScreen pnms={pnms} />;
}
