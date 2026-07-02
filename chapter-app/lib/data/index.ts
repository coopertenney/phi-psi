// The single data-access surface the UI talks to. Swaps between the mock seed
// and live Supabase based on whether env vars are set — components never know.
import type {
  MemberRow, ChapterStats, EventRow, MeetingRow, AttendanceRecord, AnnouncementRow, PnmRow,
  PointItem, PointEntry, DriveItem, RsvpState,
} from '../types';
import { isSupabaseConfigured, getServerSupabase } from '../supabase/server';
import {
  mockMembers, mockStats, mockEvents, mockMeetings, mockAttendance, mockAnnouncements, mockPnms,
  mockPointItems, mockPointEntries, mockFiles,
} from './mock';

export { CHAPTER_ID } from '../chapter';
import { CHAPTER_ID } from '../chapter';

const roleLabel = (position: string | null, status: string) =>
  position ?? (status === 'new' ? 'New Member' : 'Brother');

export async function getMembers(): Promise<MemberRow[]> {
  if (!isSupabaseConfigured) return mockMembers;

  const sb = getServerSupabase();
  // Roster (member-readable). Finance columns come from member_finances, which
  // RLS gates to self/exec — so a member only gets balances they're allowed to.
  const [{ data: standings, error: e1 }, { data: finances, error: e2 }, { data: profiles, error: e3 }] =
    await Promise.all([
      sb.from('member_standings').select('*').eq('chapter_id', CHAPTER_ID),
      sb.from('member_finances').select('*').eq('chapter_id', CHAPTER_ID),
      sb.from('memberships').select('id, position, profiles(email)').eq('chapter_id', CHAPTER_ID),
    ]);
  if (e1 || e2 || e3) throw (e1 || e2 || e3);

  const finById = new Map((finances ?? []).map((f: any) => [f.membership_id, f]));
  const emailById = new Map((profiles ?? []).map((p: any) => [p.id, p.profiles?.email ?? '']));

  return (standings ?? []).map((s: any): MemberRow => {
    const fin = finById.get(s.membership_id);
    return {
      membershipId: s.membership_id,
      fullName: s.full_name,
      email: emailById.get(s.membership_id) ?? '',
      phone: s.phone ?? '',
      position: s.position,
      roleLabel: roleLabel(s.position, s.status),
      status: s.status,
      classYear: s.class_year,
      committee: s.committee,
      // TODO(lineage/flags): wire to member_standings columns once added to the
      // schema (big_name, little_names, derived flags view). Empty until then.
      bigName: s.big_name ?? null,
      littleNames: s.little_names ?? [],
      points: s.points,
      attendancePct: s.attendance_pct,
      balanceCents: fin?.balance_cents ?? 0,
      duesState: fin?.dues_state ?? 'paid',
      flags: s.flags ?? [],
    };
  });
}

// The real signed-in member's display identity for the topbar. Null in mock
// mode (no auth) → the UI falls back to the demo MOCK_USER.
export async function getCurrentUser(): Promise<{ fullName: string; title: string } | null> {
  if (!isSupabaseConfigured) return null;
  const sb = getServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  // Look up by auth_user_id (exact, indexed — what RLS itself matches on) rather
  // than a fuzzy email-embed filter.
  const { data: prof } = await sb.from('profiles').select('id, full_name').eq('auth_user_id', user.id).maybeSingle();
  if (!prof) return { fullName: user.email ?? 'Member', title: 'Not on roster' };

  const { data: mem } = await sb.from('memberships').select('position, access_role').eq('profile_id', prof.id).maybeSingle();
  const title = mem?.position
    ?? (mem?.access_role === 'admin' ? 'Admin' : mem?.access_role === 'exec' ? 'Officer' : 'Brother');
  return { fullName: prof.full_name, title };
}

export async function getStats(): Promise<ChapterStats> {
  if (!isSupabaseConfigured) return mockStats();
  const sb = getServerSupabase();
  const { data, error } = await sb.from('chapter_stats').select('*').eq('chapter_id', CHAPTER_ID).single();
  if (error) throw error;
  return {
    activeMembers: data.active_members,
    totalMembers: data.total_members,
    paidCount: data.paid_count,
    partialCount: data.partial_count,
    dueCount: data.due_count,
    collectedCents: data.collected_cents ?? 0,
    targetCents: data.target_cents ?? 0,
    // avg over zero attendance rows is SQL NULL → show 0%, not "null%".
    avgAttendancePct: data.avg_attendance_pct ?? 0,
  };
}

// Chapter-wide payment settings. `duesPaymentsEnabled` is the Finance
// Officer's on/off switch for the Stripe "Pay" buttons (lib/stripe.ts) — off
// by default until the FO's Stripe account is linked; see stripe-dues.sql.
// Mock mode always reports enabled so the demo flow is visible end to end.
export interface ChapterSettings { duesPaymentsEnabled: boolean }

export async function getChapterSettings(): Promise<ChapterSettings> {
  if (!isSupabaseConfigured) return { duesPaymentsEnabled: true };
  const sb = getServerSupabase();
  const { data, error } = await sb.from('chapters').select('dues_payments_enabled').eq('id', CHAPTER_ID).maybeSingle();
  if (error) throw error;
  return { duesPaymentsEnabled: data?.dues_payments_enabled ?? false };
}

/* ─────────────────────────── Events & attendance ───────────────────────────
   Events + RSVPs are LIVE (see app-foundation/events-live.sql). Meetings and
   attendance are still mock — that's the next vertical. */

export interface EventRsvp { eventId: string; membershipId: string; status: RsvpState }

// DB rsvp_status ↔ app RsvpState. 'no_response' rows are ignored (treated unset).
const RSVP_IN: Record<string, RsvpState | null> = {
  going: 'going', maybe: 'maybe', declined: 'no', no_response: null,
};

function mapEvent(row: any, rsvps: any[]): EventRow {
  const counts = { going: 0, maybe: 0, no: 0 };
  for (const r of rsvps) {
    if (r.event_id !== row.id) continue;
    const s = RSVP_IN[r.status];
    if (s) counts[s]++;
  }
  return {
    id: row.id,
    title: row.name,
    type: row.type ?? 'social',
    startsAt: row.starts_at,
    endsAt: row.ends_at ?? null,
    location: row.location ?? '',
    description: row.description ?? '',
    mandatory: row.required,
    pointsValue: row.points ?? 0,
    rsvp: counts,
  };
}

export async function getEvents(): Promise<EventRow[]> {
  if (!isSupabaseConfigured) return mockEvents;
  const sb = getServerSupabase();
  const [{ data: evs, error: e1 }, { data: rs, error: e2 }] = await Promise.all([
    sb.from('events').select('*').eq('chapter_id', CHAPTER_ID).order('starts_at'),
    sb.from('rsvps').select('event_id, membership_id, status'),
  ]);
  if (e1 || e2) throw (e1 || e2);
  const rsvps = rs ?? [];
  return (evs ?? []).map((row: any) => mapEvent(row, rsvps));
}

export async function getEvent(id: string): Promise<EventRow | null> {
  if (!isSupabaseConfigured) return mockEvents.find((e) => e.id === id) ?? null;
  const sb = getServerSupabase();
  const [{ data: row }, { data: rs }] = await Promise.all([
    sb.from('events').select('*').eq('id', id).maybeSingle(),
    sb.from('rsvps').select('event_id, membership_id, status').eq('event_id', id),
  ]);
  return row ? mapEvent(row, rs ?? []) : null;
}

// Per-member RSVP records (for the exec drawer's guest list + each member's own
// choice). Empty in mock mode — the screen derives demo RSVPs there instead.
export async function getEventRsvps(): Promise<EventRsvp[]> {
  if (!isSupabaseConfigured) return [];
  const sb = getServerSupabase();
  const { data } = await sb.from('rsvps').select('event_id, membership_id, status');
  return (data ?? []).flatMap((r: any) => {
    const s = RSVP_IN[r.status];
    return s ? [{ eventId: r.event_id, membershipId: r.membership_id, status: s }] : [];
  });
}

// The signed-in member's own membership id (for RSVP writes + "my events").
// Null in mock mode (identity is the persona toggle there).
export async function getMyMembershipId(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const sb = getServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: prof } = await sb.from('profiles').select('id').eq('auth_user_id', user.id).maybeSingle();
  if (!prof) return null;
  const { data: mem } = await sb.from('memberships').select('id').eq('profile_id', prof.id).maybeSingle();
  return mem?.id ?? null;
}

export async function getMeetings(): Promise<MeetingRow[]> {
  return mockMeetings;
}

export async function getAttendance(): Promise<AttendanceRecord[]> {
  return mockAttendance;
}

export async function getAnnouncements(): Promise<AnnouncementRow[]> {
  return mockAnnouncements;
}

// TODO(live): pnms + pnm_ratings/pnm_votes/pnm_notes tables + RLS still pending.
// Serve the mock seed until that schema lands; signatures are the screen contract.
export async function getPnms(): Promise<PnmRow[]> {
  return mockPnms;
}

export async function getPnm(id: string): Promise<PnmRow | null> {
  return mockPnms.find((p) => p.id === id) ?? null;
}

// TODO(live): point_items (catalog) + point_entries (log) tables + RLS. Read =
// chapter member; write (log an entry) = exec/recruitment-or-standards approver.
export async function getPointItems(): Promise<PointItem[]> {
  return mockPointItems;
}

export async function getPointEntries(): Promise<PointEntry[]> {
  return mockPointEntries;
}

// TODO(live): a `files` table (metadata) + a Supabase Storage bucket (bytes).
// Read = chapter member; officers-only rows RLS-gated to exec; write/upload =
// exec (or the file's owner). Serves the mock tree until that lands.
export async function getFiles(): Promise<DriveItem[]> {
  if (!isSupabaseConfigured) return mockFiles;
  const sb = getServerSupabase();
  const { data, error } = await sb.from('files').select('*').eq('chapter_id', CHAPTER_ID);
  if (error) throw error;
  return (data ?? []).map((r: any): DriveItem => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    parentId: r.parent_id,
    audience: r.audience,
    ownerName: r.owner_name ?? '',
    updatedAt: r.created_at,
    sizeBytes: r.size_bytes,
    storagePath: r.storage_path,
  }));
}
