'use server';

import { getServerSupabase } from '@/lib/supabase/server';
import { requireMembershipId } from '@/lib/membership';
import { CHAPTER_ID } from '@/lib/chapter';
import { sendPushToChapter, isPushConfigured } from '@/lib/push';
import type { AnnouncementAudience } from '@/lib/types';

export interface AnnouncementInput {
  title: string;
  body: string;
  audience: AnnouncementAudience;
  category: 'general' | 'event' | 'finance' | 'urgent';
}

// A short one-line preview of the body for the notification (push bodies are
// truncated by the OS anyway; keep it tight and strip newlines).
function snippet(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
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

  // Best-effort push. The title IS the announcement's title — the OS already
  // brands it "from Phi Psi", so we never prefix the chapter name. Officers-only
  // announcements notify only exec/admin; everything else goes chapter-wide. A
  // push failure must never fail the post.
  if (isPushConfigured) {
    try {
      const { data: { user } } = await sb.auth.getUser();
      let authorProfileId: string | null = null;
      if (user) {
        const { data } = await sb.from('profiles').select('id').eq('auth_user_id', user.id).maybeSingle();
        authorProfileId = data?.id ?? null;
      }
      await sendPushToChapter(
        CHAPTER_ID,
        { title: input.title, body: snippet(input.body), url: '/announcements', tag: 'ann-new' },
        {
          excludeProfileId: authorProfileId,
          roles: input.audience === 'officers' ? ['admin', 'exec'] : undefined,
        },
      );
    } catch {
      /* notification is best-effort — ignore */
    }
  }
}

// Exec-only — RLS (ann_delete) enforces it server-side. Removing an
// announcement cascades its read rows (announcement_reads FK is ON DELETE
// CASCADE), so no manual cleanup is needed.
export async function deleteAnnouncement(id: string) {
  const sb = getServerSupabase();
  const { error } = await sb.from('announcements').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// Mark an announcement read for the signed-in member. Idempotent — the PK is
// (announcement_id, membership_id), so re-marking is a no-op. RLS
// (announcement_reads_mine) enforces you can only write your own row.
export async function markAnnouncementRead(announcementId: string) {
  return markAnnouncementsRead([announcementId]);
}

// Batch variant: mark several announcements read in one round-trip. Used by the
// feed to auto-mark everything the member can see the moment they open the tab,
// so "read" tracks *viewing* rather than a manual click. Idempotent via the same
// (announcement_id, membership_id) PK; a no-op when `ids` is empty.
export async function markAnnouncementsRead(ids: string[]) {
  if (ids.length === 0) return;
  const sb = getServerSupabase();
  const membershipId = await requireMembershipId(sb);
  const rows = ids.map((announcement_id) => ({ announcement_id, membership_id: membershipId }));
  const { error } = await sb
    .from('announcement_reads')
    .upsert(rows, { onConflict: 'announcement_id,membership_id', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}
