// Recent dues payments for the exec Finances view. Kept in its own module (not
// lib/data/index.ts) so it's a small, self-contained data surface.
//
// Live: reads the `payments` table joined to memberships → profiles for the
// payer's name. RLS lets an exec see the whole chapter's payments
// (payments_read: `... or is_chapter_exec(...)`), while a regular member would
// only ever get their own rows — harmless, since only ExecFinances renders this.
// Mock/demo: synthesizes a plausible feed from members who've paid this quarter.
import { isSupabaseConfigured, getServerSupabase } from '../supabase/server';
import { CHAPTER_ID } from '../chapter';
import { mockMembers } from './mock';
import { duesFor } from '../session';

export interface RecentPayment {
  id: string;
  memberName: string;
  amountCents: number;
  paidAt: string; // ISO — formatted for display with fmtDate() at the view
}

export async function getRecentPayments(limit = 8): Promise<RecentPayment[]> {
  if (!isSupabaseConfigured) {
    // No real payment records in mock mode. Build a stand-in feed from members
    // who've paid toward the active quarter, spaced a couple days apart so it
    // reads like a real, recent activity log (deterministic — no clock calls).
    return mockMembers
      .filter((m) => duesFor(m).paid > 0)
      .slice(0, limit)
      .map((m, i) => ({
        id: `mock-pay-${m.membershipId}`,
        memberName: m.fullName,
        amountCents: duesFor(m).paid,
        paidAt: new Date(Date.UTC(2026, 6, 4 - i * 2)).toISOString(),
      }));
  }

  const sb = getServerSupabase();
  const { data, error } = await sb
    .from('payments')
    .select('id, amount_cents, paid_at, created_at, memberships!inner(chapter_id, profiles(full_name))')
    .eq('memberships.chapter_id', CHAPTER_ID)
    .eq('status', 'succeeded')
    .order('paid_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error || !data) return [];

  return (data as unknown as RawPaymentRow[]).map((r) => ({
    id: r.id,
    memberName: r.memberships?.profiles?.full_name ?? 'Unknown member',
    amountCents: r.amount_cents,
    paidAt: r.paid_at ?? r.created_at,
  }));
}

type RawPaymentRow = {
  id: string;
  amount_cents: number;
  paid_at: string | null;
  created_at: string;
  memberships: { profiles: { full_name: string | null } | null } | null;
};
