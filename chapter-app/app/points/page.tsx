import { getMembers, getPointEntries, getPointItems } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { PointsScreen } from '@/components/PointsScreen';

export default async function PointsPage() {
  const [members, entries, items] = await Promise.all([
    getMembers(), getPointEntries(), getPointItems(),
  ]);
  return <PointsScreen members={members} entries={entries} items={items} live={isSupabaseConfigured} />;
}
