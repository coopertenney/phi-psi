// UI-facing types. The data-layer (lib/data) returns these regardless of
// whether the source is the mock seed or live Supabase, so components never
// care which backend is active. Mirrors app-foundation/types.ts.

export type MemberStatus = 'active' | 'new' | 'inactive';
export type DuesState = 'paid' | 'partial' | 'due';
export type Role = 'exec' | 'member';
export type Theme = 'cardinal' | 'hunter' | 'heritage';

// Accountability / compliance flag raised on a member (e.g. overdue dues,
// missing risk-management form, below attendance minimum). Some are derived
// from data, some set manually by exec/standards.
export type FlagSeverity = 'danger' | 'warning' | 'info';
export interface MemberFlag {
  id: string;
  label: string;
  severity: FlagSeverity;
  note?: string;
}

// One row of the Members table + everything the detail drawer needs.
// In live mode: roster fields come from member_standings (member-readable),
// finance fields from member_finances (RLS-gated to self/exec).
export interface MemberRow {
  membershipId: string;
  fullName: string;
  avatarUrl?: string | null;  // uploaded profile photo (public URL); absent/null → initials
  email: string;
  phone: string;
  position: string | null;   // office title; null = no office
  roleLabel: string;         // display: position, else "Brother"/"New Member"
  status: MemberStatus;
  classYear: number | null;
  committee: string | null;
  bigName: string | null;    // lineage: who initiated/mentors this member
  littleNames: string[];     // lineage: members this brother bigs
  points: number;
  attendancePct: number;
  balanceCents: number;
  chargedCents: number;      // live dues charged this term (member_finances)
  paidCents: number;         // live dues paid this term (member_finances)
  duesState: DuesState;
  flags: MemberFlag[];       // accountability / compliance flags
}

export interface ChapterStats {
  activeMembers: number;
  totalMembers: number;
  paidCount: number;
  partialCount: number;
  dueCount: number;
  collectedCents: number;
  targetCents: number;
  avgAttendancePct: number;
}

/* ─────────────────────────── Events & attendance ───────────────────────────
   In live mode: events/rsvps/meetings/attendance tables (RLS read = chapter
   member, write = exec, RSVPs writable by self). See CLAUDE.md "RLS still
   needed". For now these come from the mock seed via lib/data. */

export type EventType =
  | 'meeting' | 'philanthropy' | 'social' | 'brotherhood' | 'service' | 'mandatory' | 'recruitment';
export type RsvpState = 'going' | 'maybe' | 'no'; // absence of a response = null
// present/late/absent are per-meeting marks; excused/abroad also stand in for a
// standing MemberTermStatus. Attendance % = present / (present + absent) — late,
// excused and abroad are neutral (dropped from the denominator).
export type AttendanceState = 'present' | 'late' | 'absent' | 'excused' | 'abroad';

// A standing, all-quarter status for one member: 'abroad' the whole term, or a
// recurring 'excused' with a free-text reason. Seeds the take-attendance grid.
export type TermStatusKind = 'abroad' | 'excused';
export interface MemberTermStatus {
  membershipId: string;
  kind: TermStatusKind;
  reason: string | null;
}

export interface EventRow {
  id: string;
  title: string;
  type: EventType;
  startsAt: string;          // ISO
  endsAt: string | null;     // ISO
  location: string;
  description: string;
  mandatory: boolean;
  pointsValue: number;       // points awarded for attending
  rsvp: { going: number; maybe: number; no: number }; // aggregate counts
}

// A recurring chapter meeting — the basis for each member's attendance %.
export interface MeetingRow {
  id: string;
  title: string;
  date: string;              // ISO
  checkinOpen?: boolean;     // members may self-check-in with the rotating code
}

// Raw attendance facts for one member across the meeting series (ordered to
// match MeetingRow[]). The displayed attendancePct is derived from these.
export interface AttendanceRecord {
  membershipId: string;
  states: AttendanceState[];
}

/* ─────────────────────────── Points / accountability ───────────────────────
   Ported from the chapter's Google-Sheet tracker. An item catalog assigns a
   fixed point value to each task (rewards +, punishments −); the log records who
   earned/lost what; a member's total is MAX(-5, Σ their entries) — see
   lib/points.ts. Live mode = point_items + point_entries tables. */

export type PointKind = 'reward' | 'punishment';

// 'approved' = counts toward the member's total (exec-logged entries and
// approved member requests). 'pending' = a member self-logged this reward and
// it awaits exec approval — visible in the ledger but excluded from totals.
export type PointEntryStatus = 'pending' | 'approved';

export interface PointItem {
  id: string;
  label: string;
  points: number;            // catalog value; 0 when discretionary
  kind: PointKind;
  discretionary: boolean;    // sheet's "?" items — exec sets the value per entry
}

export interface PointEntry {
  id: string;
  membershipId: string;
  itemId: string;
  label: string;             // denormalized from the catalog (as the sheet stores it)
  points: number;
  date: string;              // ISO
  approvedBy: string;        // exec who logged/approved; '' while pending
  status: PointEntryStatus;  // pending member requests don't count toward totals
  note?: string;
}

/* ─────────────────────────── Announcements ─────────────────────────── */

export type AnnouncementAudience = 'all' | 'officers';
export type AnnouncementCategory = 'general' | 'event' | 'finance' | 'urgent';

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  author: string;
  authorRole: string;
  createdAt: string;         // ISO
  audience: AnnouncementAudience;
  pinned: boolean;
  category: AnnouncementCategory;
}

/* ─────────────────────────── Recruitment / Rush CRM ───────────────────────────
   PNM = Potential New Member. The rush pipeline; in live mode these come from
   pnms/pnm_ratings/pnm_votes/pnm_notes tables (read = chapter member, write =
   member for own rating/vote/note, stage transitions = exec/recruitment chair). */

export type PnmStage =
  | 'prospect' | 'invited' | 'interview' | 'voting' | 'bid' | 'accepted' | 'declined';

export interface PnmNote {
  id: string;
  author: string;
  text: string;
  when: string;              // ISO
}

export interface PnmRow {
  id: string;
  fullName: string;
  standing: string;          // class standing, e.g. "Sophomore"
  major: string;
  email: string;
  phone: string;
  referredBy: string | null; // brother who referred them
  stage: PnmStage;
  rating: number;            // average brother rating, 0–5 (1 decimal)
  ratingCount: number;       // how many brothers have rated
  votesYes: number;          // chapter vote tally (meaningful at voting/bid)
  votesNo: number;
  eventsAttended: number;    // rush events attended
}

/* ─────────────────────────────── Files (Drive) ───────────────────────────────
   A Google-Drive-style document store. A flat list keyed by `parentId` forms the
   folder tree (parentId null = root). In live mode: metadata comes from a `files`
   table (read = chapter member, officers-only rows RLS-gated to exec) and the
   bytes live in a Supabase Storage bucket. */

// 'folder' plus the file types we render a distinct glyph for.
export type FileKind = 'folder' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'image' | 'file' | 'link';

export interface DriveItem {
  id: string;
  name: string;
  kind: FileKind;
  parentId: string | null;          // null = top level
  audience: AnnouncementAudience;    // 'all' or 'officers' (exec-only)
  ownerName: string;
  updatedAt: string;                 // ISO
  sizeBytes: number | null;          // null for folders
  storagePath?: string | null;       // bucket path (live uploaded files; for download)
  url?: string | null;               // external URL (kind 'link'; opens in a new tab)
}
