import { getAnnouncements, getMyAnnouncementReads } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { AnnouncementsScreen } from '@/components/AnnouncementsScreen';

// Server component: fetch the chapter feed + which ones the signed-in member
// has already read. Exec can compose and sees officers-only posts; members see
// the all-chapter feed (RLS enforces the officers-only boundary in live mode).
export default async function AnnouncementsPage() {
  const [announcements, myReadIds] = await Promise.all([
    getAnnouncements(),
    getMyAnnouncementReads(),
  ]);
  return <AnnouncementsScreen announcements={announcements} myReadIds={myReadIds} live={isSupabaseConfigured} />;
}
