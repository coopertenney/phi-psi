'use server';

import { getServerSupabase } from '@/lib/supabase/server';
import { requireMembershipId } from '@/lib/membership';
import { CHAPTER_ID } from '@/lib/chapter';
import type { AnnouncementAudience } from '@/lib/types';

export interface AnnouncementInput {
  title: string;
  body: string;
  audience: AnnouncementAudience;
  category: 'general' | 'event' | 'finance' | 'urgent';
}

// Exec-only — RLS (ann_write) enforces it server-side. author_id is the
// signed-in exec's own membership row.
export async function postAnnouncement(input: AnnouncementInput) {
  const sb = getServerSupabase();
  const membershipId = await requireMembershipId(sb);

  const { error } = await sb.from('announcements').insert({
    chapter_id: CHAPTER_ID,
    author_id: membershipId,
    title: input.title,
    body: input.body,
    audience: input.audience,
    category: input.category,
    pinned: false,
  });
  if (error) throw new Error(error.message);
}
