'use server';

import { getServerSupabase } from '@/lib/supabase/server';

const CHAPTER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

export interface AnnouncementInput {
  title: string;
  body: string;
  audience: 'all' | 'officers';
  category: 'general' | 'event' | 'finance' | 'urgent';
}

// Exec-only — RLS (ann_write) enforces it server-side. author_id is the
// signed-in exec's own membership row.
export async function postAnnouncement(input: AnnouncementInput) {
  const sb = getServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data: prof } = await sb.from('profiles').select('id').eq('auth_user_id', user.id).maybeSingle();
  const { data: mem } = prof
    ? await sb.from('memberships').select('id').eq('profile_id', prof.id).maybeSingle()
    : { data: null };
  if (!mem) throw new Error('You’re not on the roster');

  const { error } = await sb.from('announcements').insert({
    chapter_id: CHAPTER_ID,
    author_id: mem.id,
    title: input.title,
    body: input.body,
    audience: input.audience,
    category: input.category,
    pinned: false,
  });
  if (error) throw new Error(error.message);
}
