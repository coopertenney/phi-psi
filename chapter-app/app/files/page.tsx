import { getFiles, getCurrentUser } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { FilesScreen } from '@/components/FilesScreen';

// Server component: fetch the chapter's document tree from the `files` table
// (mock in dev-without-Supabase). Officers-only items are gated by RLS.
export default async function FilesPage() {
  const [files, currentUser] = await Promise.all([getFiles(), getCurrentUser()]);
  return (
    <FilesScreen
      items={files}
      live={isSupabaseConfigured}
      ownerName={currentUser?.fullName ?? 'Me'}
    />
  );
}
