import { getAnnouncements } from '@/lib/data';
import { AnnouncementsScreen } from '@/components/AnnouncementsScreen';

// Server component: fetch the chapter feed. Exec can compose and sees
// officers-only posts; members see the all-chapter feed (gated client-side
// here, by RLS audience filtering in live mode).
export default async function AnnouncementsPage() {
  const announcements = await getAnnouncements();
  return <AnnouncementsScreen announcements={announcements} />;
}
