// The single data-access surface the UI talks to. Swaps between the mock seed
// and live Supabase based on whether env vars are set — components never know.
import type {
  MemberRow, ChapterStats, EventRow, MeetingRow, AttendanceRecord, AttendanceState, AnnouncementRow, PnmRow, PnmNote,
  PointItem, PointEntry, DriveItem, MemberTermStatus,
} from '../types';
import { cache } from 'react';
import { isSupabaseConfigured, getServerSupabase } from '../supabase/server';
import { resolveMembershipId, resolveIdentity } from '../membership';
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

// Shared roster fetch. Alumni are membership rows with status 'inactive'; they
// exist ONLY so the lineage tree can render their big–little history. They are
// EXCLUDED from every user-facing surface (roster, dashboard, search, points,
// finances) — `includeAlumni` is true only for the Lineage tab (getLineageRoster).
// Deduped per request per arg: the layout and pages share getMembers() without
// re-running the three roster queries; lineage's unfiltered fetch is cached apart.
const fetchRoster = cache(async (includeAlumni: boolean): Promise<MemberRow[]> => {
  if (!isSupabaseConfigured) {
    return includeAlumni ? mockMembers : mockMembers.filter((m) => m.status !== 'inactive');
  }

  const sb = getServerSupabase();
  // Roster (member-readable). Finance columns come from member_finances, which
  // RLS gates to self/exec — so a member only gets balances they're allowed to.
  let standingsQuery = sb.from('member_standings').select('*').eq('chapter_id', CHAPTER_ID);
  if (!includeAlumni) standingsQuery = standingsQuery.neq('status', 'inactive');
  const [{ data: standings, error: e1 }, { data: finances, error: e2 }, { data: profiles, error: e3 }] =
    await Promise.all([
      standingsQuery,
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
      avatarUrl: s.avatar_url ?? null,
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
});

// The active/new roster — every user-facing surface uses this. Alumni excluded.
export const getMembers = (): Promise<MemberRow[]> => fetchRoster(false);

// Lineage-only roster: includes alumni (status 'inactive') so the full big–little
// history renders. NEVER use this for member lists, dropdowns, stats, or search.
export const getLineageRoster = (): Promise<MemberRow[]> => fetchRoster(true);

// The real signed-in member's display identity for the topbar. Null in mock
// mode (no auth) → the UI falls back to the demo MOCK_USER. `accessRole` is the
// permission axis (exec/member/admin) the sidebar derives its persona from —
// null when the signed-in user isn't on the roster yet (treated as least
// privilege by the caller).
export const getCurrentUser = cache(async (): Promise<
  {
    fullName: string;
    title: string;
    avatarUrl: string | null;
    accessRole: 'admin' | 'exec' | 'member' | null;
    status: 'active' | 'new' | 'inactive' | null;
  } | null
> => {
  if (!isSupabaseConfigured) return null;
  // Shared identity join (deduped per request in lib/membership).
  const id = await resolveIdentity();
  if (!id) return null; // not signed in
  if (!id.onRoster) return { fullName: id.email ?? 'Member', title: 'Not on roster', avatarUrl: null, accessRole: null, status: null };

  const title = id.position ?? accessRoleLabel(id.accessRole);
  return { fullName: id.fullName ?? id.email ?? 'Member', title, avatarUrl: id.avatarUrl, accessRole: id.accessRole, status: id.status };
});

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
export interface ChapterSettings {
  duesPaymentsEnabled: boolean;
  // Points-engine config (chapters.points_*). The client engine clamps totals to
  // [floor, ceiling]; resetEachTerm scopes totals to the current term.
  pointsFloor: number;
  pointsCeiling: number | null;
  pointsResetEachTerm: boolean;
  currentTermId: string | null;   // for reset scoping on the client
}

export async function getChapterSettings(): Promise<ChapterSettings> {
  if (!isSupabaseConfigured) {
    return { duesPaymentsEnabled: true, pointsFloor: -5, pointsCeiling: null, pointsResetEachTerm: false, currentTermId: null };
  }
  const sb = getServerSupabase();
  const [cfg, { data: term }] = await Promise.all([
    sb.from('chapters').select('dues_payments_enabled, points_floor, points_ceiling, points_reset_each_term').eq('id', CHAPTER_ID).maybeSingle(),
    sb.from('terms').select('id').eq('chapter_id', CHAPTER_ID).eq('is_current', true).maybeSingle(),
  ]);
  // Degrade gracefully if the points-rules migration hasn't run yet (this getter
  // also powers the Finances dues toggle, so a 500 here would take down Finances
  // too): fall back to the base column and default the scoring config.
  let data = cfg.data as any;
  if (cfg.error) {
    const base = await sb.from('chapters').select('dues_payments_enabled').eq('id', CHAPTER_ID).maybeSingle();
    if (base.error) throw base.error;
    data = base.data;
  }
  return {
    duesPaymentsEnabled: data?.dues_payments_enabled ?? false,
    pointsFloor: data?.points_floor ?? -5,
    pointsCeiling: data?.points_ceiling ?? null,
    pointsResetEachTerm: data?.points_reset_each_term ?? false,
    currentTermId: term?.id ?? null,
  };
}

/* ─────────────────────────── Events & attendance ───────────────────────────
   Events are LIVE (see app-foundation/events-live.sql). RSVPs are handled in
   Partiful (each social carries an optional invite link) — the app stores no
   per-member RSVP. Meetings and attendance are still mock — the next vertical. */

function mapEvent(row: any): EventRow {
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
    partifulUrl: row.partiful_url ?? null,
  };
}

export async function getEvents(): Promise<EventRow[]> {
  if (!isSupabaseConfigured) return mockEvents;
  const sb = getServerSupabase();
  const { data, error } = await sb.from('events').select('*').eq('chapter_id', CHAPTER_ID).order('starts_at');
  if (error) throw error;
  return (data ?? []).map(mapEvent);
}

// The signed-in member's own membership id (used to resolve "me" in live mode).
// Null in mock mode (identity is the persona toggle there).
export async function getMyMembershipId(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  return resolveMembershipId(getServerSupabase());
}

export async function getMeetings(): Promise<MeetingRow[]> {
  if (!isSupabaseConfigured) return mockMeetings;
  const sb = getServerSupabase();
  const { data, error } = await sb.from('meetings').select('id, title, held_on, checkin_open').eq('chapter_id', CHAPTER_ID).order('held_on');
  if (error) throw error;
  return (data ?? []).map((r: any): MeetingRow => ({ id: r.id, title: r.title, date: r.held_on, checkinOpen: r.checkin_open ?? false }));
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

// Standing all-quarter statuses (abroad / recurring excuse) for the current
// term — seeds the take-attendance grid and shows badges on the roster.
export async function getMemberTermStatuses(): Promise<MemberTermStatus[]> {
  if (!isSupabaseConfigured) return [];
  const sb = getServerSupabase();
  const { data: term } = await sb
    .from('terms').select('id').eq('chapter_id', CHAPTER_ID).eq('is_current', true).maybeSingle();
  if (!term) return [];
  const { data, error } = await sb
    .from('member_term_statuses')
    .select('membership_id, kind, reason')
    .eq('chapter_id', CHAPTER_ID)
    .eq('term_id', term.id);
  if (error) throw error;
  return (data ?? []).map((r: any): MemberTermStatus => ({
    membershipId: r.membership_id, kind: r.kind, reason: r.reason ?? null,
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

// Announcement ids the signed-in member has marked read. RLS
// (announcement_reads_mine) already scopes the query to the caller's own rows,
// so no membership filter is needed here. Empty in mock mode.
export async function getMyAnnouncementReads(): Promise<string[]> {
  if (!isSupabaseConfigured) return [];
  const sb = getServerSupabase();
  const { data, error } = await sb.from('announcement_reads').select('announcement_id');
  if (error) throw error;
  return (data ?? []).map((r: any) => r.announcement_id as string);
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
  const full = await sb
    .from('point_items')
    .select('id, label, points, kind, discretionary, sort_order, archived, max_per_term, auto_trigger, self_loggable, auto_approve')
    .eq('chapter_id', CHAPTER_ID).order('sort_order');
  if (!full.error) {
    return (full.data ?? []).map((r: any): PointItem => ({
      id: r.id, label: r.label, points: r.points, kind: r.kind, discretionary: r.discretionary,
      sortOrder: r.sort_order ?? 0, archived: r.archived ?? false,
      maxPerTerm: r.max_per_term ?? null, autoTrigger: r.auto_trigger ?? null,
      selfLoggable: r.self_loggable ?? null, autoApprove: r.auto_approve ?? false,
    }));
  }
  // Degrade gracefully if the catalog-CRUD / rules migrations haven't been run
  // yet (code deployed before SQL): read the original columns, default the rest.
  const base = await sb.from('point_items').select('id, label, points, kind, discretionary').eq('chapter_id', CHAPTER_ID);
  if (base.error) throw base.error;
  return (base.data ?? []).map((r: any, i: number): PointItem => ({
    id: r.id, label: r.label, points: r.points, kind: r.kind, discretionary: r.discretionary,
    sortOrder: i + 1, archived: false, maxPerTerm: null, autoTrigger: null, selfLoggable: null, autoApprove: false,
  }));
}

export async function getPointEntries(): Promise<PointEntry[]> {
  if (!isSupabaseConfigured) return mockPointEntries;
  const sb = getServerSupabase();
  const { data, error } = await sb
    .from('points_entries')
    .select('id, membership_id, item_id, points, approved_by, status, term_id, created_at, point_items(label), memberships!inner(chapter_id)')
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
    termId: r.term_id ?? null,
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
