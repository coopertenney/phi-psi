import { getMembers } from '@/lib/data';
import { MembersScreen } from '@/components/MembersScreen';

// Server component: fetch on the server (mock now, Supabase once configured),
// hand data to the interactive client screen.
export default async function MembersPage() {
  const members = await getMembers();
  return <MembersScreen members={members} />;
}
