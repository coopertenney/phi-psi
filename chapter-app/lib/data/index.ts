// The single data-access surface the UI talks to. Swaps between the mock seed
// and live Supabase based on whether env vars are set — components never know.
import type {
  MemberRow, ChapterStats, EventRow, MeetingRow, AttendanceRecord, AttendanceState, AnnouncementRow, PnmRow, PnmNote,
  PointItem, PointEntry, DriveItem, RsvpState,
} from '../types';
import { isSupabaseConfigured, getServerSupabase } from '../supabase/server';
import { resolveMembershipId } from '../membership';
import {
  mockMembers, mockStats, mockEvents, mockMeetings, mockAttendance, mockAnnouncements, mockPnms,
  mockPointItems, mockPointEntries, mockFiles,
} from './mock';

export { CHAPTER_ID } from '../chapter';
import { CHAPTER_ID } from '../chapter';

const roleLabel = (position: string | null, status: string) =>
  position ?? (status === 'new' ? 'New Member' : 'Brother');

// access_role → display label, used where there's no explicit position title.
const accessRoleLabel = (role: string | null): string =>
  role === 'admin' ? 'Admin' : role === 'exec' ? 'Officer' : 'Brother';

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
      chargedCents: fin?.charged_cents ?? 0,
      paidCents: fin?.paid_cents ?? 0,
      duesState: fin?.dues_state ?? 'paid',
      flags: s.flags ?? [],
    };
  });
}

// The real signed-in member's display identity for the topbar. Null in mock
// mode (no auth) → the UI falls back to the demo MOCK_USER. `accessRole` is the
// permission axis (exec/member/admin) the sidebar derives its persona from —
// null when the signed-in user isn't on the roster yet (treated as least
// privilege by the caller).
export async function getCurrentUser(): Promise<
  {
    fullName: string;
    title: string;
    accessRole: 'admin' | 'exec' | 'member' | null;
    status: 'active' | 'new' | 'inactive' | null;
  } | null
> {
  if (!isSupabaseConfigured) return null;
  const sb = getServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  // Look up by auth_user_id (exact, indexed — what RLS itself matches on) rather
  // than a fuzzy email-embed filter.
  const { data: prof } = await sb.from('profiles').select('id, full_name').eq('auth_user_id', user.id).maybeSingle();
  if (!prof) return { fullName: user.email ?? 'Member', title: 'Not on roster', accessRole: null, status: null };

  const { data: mem } = await sb.from('memberships').select('position, access_role, status').eq('profile_id', prof.id).maybeSingle();
  const accessRole = (mem?.access_role as 'admin' | 'exec' | 'member' | undefined) ?? null;
  const status = (mem?.status as 'active' | 'new' | 'inactive' | undefined) ?? null;
  const title = mem?.position ?? accessRoleLabel(accessRole);
  return { fullName: prof.full_name, title, accessRole, status };
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
  return resolveMembershipId(getServerSupabase());
}

export async function getMeetings(): Promise<MeetingRow[]> {
  if (!isSupabaseConfigured) return mockMeetings;
  const sb = getServerSupabase();
  const { data, error } = await sb.from('meetings').select('id, title, held_on').eq('chapter_id', CHAPTER_ID).order('held_on');
  if (error) throw error;
  return (data ?? []).map((r: any): MeetingRow => ({ id: r.id, title: r.title, date: r.held_on }));
}

export async function getAttendance(): Promise<AttendanceRecord[]> {
  if (!isSupabaseConfigured) return mockAttendance;
  const sb = getServerSupabase();
  const [{ data: meetings, error: e1 }, { data: memberships, error: e2 }] = await Promise.all([
    sb.from('meetings').select('id').eq('chapter_id', CHAPTER_ID).order('held_on'),
    sb.from('memberships').select('id').eq('chapter_id', CHAPTER_ID),
  ]);
  if (e1 || e2) throw (e1 || e2);
  const meetingIds = (meetings ?? []).map((m: any) => m.id as string);
  if (meetingIds.length === 0) return (memberships ?? []).map((m: any): AttendanceRecord => ({ membershipId: m.id, states: [] }));

  const { data: att, error: e3 } = await sb.from('attendance').select('membership_id, meeting_id, state').in('meeting_id', meetingIds);
  if (e3) throw e3;

  const byMember = new Map<string, Map<string, AttendanceState>>();
  for (const row of att ?? []) {
    if (!byMember.has(row.membership_id)) byMember.set(row.membership_id, new Map());
    byMember.get(row.membership_id)!.set(row.meeting_id, row.state);
  }

  return (memberships ?? []).map((m: any): AttendanceRecord => ({
    membershipId: m.id,
    states: meetingIds.map((mid) => byMember.get(m.id)?.get(mid) ?? 'absent'),
  }));
}

// Per-event check-in state, keyed by event id then membership id — for the
// EventDrawer's check-in list to show what was already saved (live mode
// backs check-in with a meeting row linked via meetings.event_id).
export async function getEventCheckins(): Promise<Record<string, Record<string, AttendanceState>>> {
  if (!isSupabaseConfigured) return {};
  const sb = getServerSupabase();
  const { data: meetings, error: e1 } = await sb
    .from('meetings').select('id, event_id').eq('chapter_id', CHAPTER_ID).not('event_id', 'is', null);
  if (e1) throw e1;
  const eventIdByMeeting = new Map((meetings ?? []).map((m: any) => [m.id, m.event_id as string]));
  const meetingIds = [...eventIdByMeeting.keys()];
  if (meetingIds.length === 0) return {};

  const { data: att, error: e2 } = await sb.from('attendance').select('meeting_id, membership_id, state').in('meeting_id', meetingIds);
  if (e2) throw e2;

  const out: Record<string, Record<string, AttendanceState>> = {};
  for (const row of att ?? []) {
    const eventId = eventIdByMeeting.get(row.meeting_id);
    if (!eventId) continue;
    (out[eventId] ??= {})[row.membership_id] = row.state;
  }
  return out;
}

export async function getAnnouncements(): Promise<AnnouncementRow[]> {
  if (!isSupabaseConfigured) return mockAnnouncements;
  const sb = getServerSupabase();
  // RLS (ann_read) already restricts officers-only rows to exec — no further
  // filtering needed here, unlike the mock path which filters client-side.
  const { data, error } = await sb
    .from('announcements')
    // Disambiguate the embed: announcements links to memberships via BOTH
    // author_id and the announcement_reactions junction, so name the FK.
    .select('id, title, body, pinned, audience, category, created_at, memberships!announcements_author_id_fkey(position, access_role, profiles(full_name))')
    .eq('chapter_id', CHAPTER_ID)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any): AnnouncementRow => {
    const mem = r.memberships;
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      author: mem?.profiles?.full_name ?? 'Chapter',
      authorRole: mem?.position ?? accessRoleLabel(mem?.access_role ?? null),
      createdAt: r.created_at,
      audience: r.audience,
      pinned: r.pinned,
      category: r.category,
    };
  });
}

// rating/vote counts + averages are DERIVED from pnm_ratings/pnm_votes at read
// time — never stored, same rule as the rest of the schema.
export async function getPnms(): Promise<PnmRow[]> {
  if (!isSupabaseConfigured) return mockPnms;
  const sb = getServerSupabase();
  const [{ data: pnms, error: e1 }, { data: ratings, error: e2 }, { data: votes, error: e3 }] = await Promise.all([
    sb.from('pnms').select('*').eq('chapter_id', CHAPTER_ID).order('created_at', { ascending: false }),
    sb.from('pnm_ratings').select('pnm_id, rating'),
    sb.from('pnm_votes').select('pnm_id, vote'),
  ]);
  if (e1 || e2 || e3) throw (e1 || e2 || e3);

  const ratingsByPnm = new Map<string, number[]>();
  for (const r of ratings ?? []) {
    const arr = ratingsByPnm.get(r.pnm_id) ?? [];
    arr.push(r.rating);
    ratingsByPnm.set(r.pnm_id, arr);
  }
  const votesByPnm = new Map<string, { yes: number; no: number }>();
  for (const v of votes ?? []) {
    const cur = votesByPnm.get(v.pnm_id) ?? { yes: 0, no: 0 };
    if (v.vote === 'yes') cur.yes++; else cur.no++;
    votesByPnm.set(v.pnm_id, cur);
  }

  return (pnms ?? []).map((p: any): PnmRow => {
    const rs = ratingsByPnm.get(p.id) ?? [];
    const vt = votesByPnm.get(p.id) ?? { yes: 0, no: 0 };
    return {
      id: p.id,
      fullName: p.full_name,
      standing: p.standing ?? '',
      major: p.major ?? '',
      email: p.email ?? '',
      phone: p.phone ?? '',
      referredBy: p.referred_by,
      stage: p.stage,
      rating: rs.length ? Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 10) / 10 : 0,
      ratingCount: rs.length,
      votesYes: vt.yes,
      votesNo: vt.no,
      eventsAttended: p.events_attended,
    };
  });
}

// Note thread per PNM, keyed by pnm id. Empty in mock mode — RecruitmentScreen
// derives deterministic demo notes there instead (lib/recruitment.ts pnmNotes).
export async function getPnmNotes(): Promise<Record<string, PnmNote[]>> {
  if (!isSupabaseConfigured) return {};
  const sb = getServerSupabase();
  const { data, error } = await sb
    .from('pnm_notes')
    .select('id, pnm_id, body, created_at, memberships(profiles(full_name))')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const out: Record<string, PnmNote[]> = {};
  for (const r of (data ?? []) as any[]) {
    (out[r.pnm_id] ??= []).push({
      id: r.id,
      author: r.memberships?.profiles?.full_name ?? 'Brother',
      text: r.body,
      when: r.created_at,
    });
  }
  return out;
}

// The signed-in member's own rating/vote per PNM, so the drawer shows what
// they already submitted instead of resetting to blank on every visit.
export async function getMyPnmChoices(): Promise<{ ratings: Record<string, number>; votes: Record<string, 'yes' | 'no'> }> {
  const empty = { ratings: {}, votes: {} };
  if (!isSupabaseConfigured) return empty;
  const membershipId = await getMyMembershipId();
  if (!membershipId) return empty;
  const sb = getServerSupabase();
  const [{ data: ratings }, { data: votes }] = await Promise.all([
    sb.from('pnm_ratings').select('pnm_id, rating').eq('membership_id', membershipId),
    sb.from('pnm_votes').select('pnm_id, vote').eq('membership_id', membershipId),
  ]);
  return {
    ratings: Object.fromEntries((ratings ?? []).map((r: any) => [r.pnm_id, r.rating])),
    votes: Object.fromEntries((votes ?? []).map((v: any) => [v.pnm_id, v.vote])),
  };
}

export async function getPointItems(): Promise<PointItem[]> {
  if (!isSupabaseConfigured) return mockPointItems;
  const sb = getServerSupabase();
  const { data, error } = await sb
    .from('point_items').select('id, label, points, kind, discretionary')
    .eq('chapter_id', CHAPTER_ID).order('sort_order');
  if (error) throw error;
  return (data ?? []).map((r: any): PointItem => ({
    id: r.id, label: r.label, points: r.points, kind: r.kind, discretionary: r.discretionary,
  }));
}

export async function getPointEntries(): Promise<PointEntry[]> {
  if (!isSupabaseConfigured) return mockPointEntries;
  const sb = getServerSupabase();
  const { data, error } = await sb
    .from('points_entries')
    .select('id, membership_id, item_id, points, approved_by, status, created_at, point_items(label), memberships!inner(chapter_id)')
    .eq('memberships.chapter_id', CHAPTER_ID)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any): PointEntry => ({
    id: r.id,
    membershipId: r.membership_id,
    itemId: r.item_id,
    label: r.point_items?.label ?? '(deleted item)',
    points: r.points,
    date: r.created_at,
    approvedBy: r.approved_by ?? '',
    status: r.status ?? 'approved',
  }));
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
    url: r.url ?? null,
  }));
}
