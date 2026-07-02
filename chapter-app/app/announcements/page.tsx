import { getAnnouncements } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { AnnouncementsScreen } from '@/components/AnnouncementsScreen';

// Server component: fetch the chapter feed. Exec can compose and sees
// officers-only posts; members see the all-chapter feed (RLS enforces the
// officers-only boundary at the database level in live mode).
export default async function AnnouncementsPage() {
  const announcements = await getAnnouncements();
  return <AnnouncementsScreen announcements={announcements} live={isSupabaseConfigured} />;
}
