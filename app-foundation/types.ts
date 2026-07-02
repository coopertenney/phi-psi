// ============================================================================
// Phi Kappa Psi — Chapter Dashboard
// TypeScript types mirroring schema.sql
//
// Two layers, kept deliberately separate:
//   1. Row types        — exactly what's in each table (what you store)
//   2. View-model types — the shapes the UI renders (what you derive)
//
// The view-model section replaces the prototype's computeVals(): same fields,
// now backed by real rows + the SQL views (member_standings, chapter_stats).
// Money is always integer CENTS in the data layer; format to "$850" only in UI.
// ============================================================================

// ---------------------------------------------------------------------------
// Enums (match the Postgres enum types)
// ---------------------------------------------------------------------------
export type MemberStatus   = 'active' | 'new' | 'inactive';
export type AccessRole     = 'member' | 'exec' | 'admin';
export type EventType      = 'chapter' | 'philanthropy' | 'social' | 'recruitment' | 'service' | 'other';
export type RsvpStatus     = 'going' | 'maybe' | 'declined' | 'no_response';
export type AttendanceState = 'present' | 'excused' | 'absent';
export type PaymentStatus  = 'succeeded' | 'pending' | 'failed' | 'refunded';
export type DuesState      = 'paid' | 'partial' | 'due'; // DERIVED — never a column

type UUID = string;
type Timestamp = string; // ISO 8601

// ---------------------------------------------------------------------------
// 1. Row types — one per table
// ---------------------------------------------------------------------------
export interface Chapter {
  id: UUID;
  name: string;
  designation: string | null;   // "Cal Beta"
  school: string | null;        // "Stanford"
  created_at: Timestamp;
}

export interface Profile {
  id: UUID;                      // own id — NOT auth.users.id
  auth_user_id: UUID | null;     // links to a Supabase login once they have one
  full_name: string;
  email: string;
  created_at: Timestamp;
}

export interface Membership {
  id: UUID;
  chapter_id: UUID;
  profile_id: UUID;
  access_role: AccessRole;       // permissions
  position: string | null;       // title, e.g. "Treasurer"; null = no office
  status: MemberStatus;
  class_year: number | null;
  committee: string | null;
  joined_at: Timestamp;
}

export interface Term {
  id: UUID;
  chapter_id: UUID;
  name: string;
  dues_cents: number;
  starts_on: string | null;
  ends_on: string | null;
  is_current: boolean;
}

export interface EventRow {
  id: UUID;
  chapter_id: UUID;
  term_id: UUID | null;
  name: string;
  type: EventType;
  starts_at: Timestamp;
  location: string | null;
  required: boolean;
  points: number;
  capacity: number | null;
  created_at: Timestamp;
}

export interface Rsvp {
  id: UUID;
  event_id: UUID;
  membership_id: UUID;
  status: RsvpStatus;
  created_at: Timestamp;
}

export interface Meeting {
  id: UUID;
  chapter_id: UUID;
  term_id: UUID | null;
  event_id: UUID | null;
  title: string;
  held_on: string;
}

export interface AttendanceRow {
  id: UUID;
  meeting_id: UUID;
  membership_id: UUID;
  state: AttendanceState;
}

export interface PointsEntry {
  id: UUID;
  membership_id: UUID;
  term_id: UUID | null;
  points: number;
  reason: string | null;
  event_id: UUID | null;
  created_at: Timestamp;
}

export interface DuesCharge {
  id: UUID;
  membership_id: UUID;
  term_id: UUID;
  amount_cents: number;
  description: string | null;
  created_at: Timestamp;
}

export interface Payment {
  id: UUID;
  membership_id: UUID;
  dues_charge_id: UUID | null;
  amount_cents: number;
  status: PaymentStatus;
  stripe_payment_intent_id: string | null;
  paid_at: Timestamp | null;
  created_at: Timestamp;
}

export interface Announcement {
  id: UUID;
  chapter_id: UUID;
  author_id: UUID | null;
  title: string;
  body: string;
  pinned: boolean;
  created_at: Timestamp;
}

// ---------------------------------------------------------------------------
// 2. View-model types — what the dashboard renders (derived; see SQL views)
// ---------------------------------------------------------------------------

// Backed by the member_standings view (roster — readable by any chapter member).
export interface MemberStanding {
  membership_id: UUID;
  chapter_id: UUID;
  full_name: string;
  position: string | null;
  status: MemberStatus;
  class_year: number | null;
  committee: string | null;
  points: number;
  attendance_pct: number;
}

// Backed by the member_finances view. RLS-gated: a member only ever gets their
// OWN row back; exec gets the whole chapter. Keep these columns out of any
// member-readable query — that separation is the security boundary, not a UI choice.
export interface MemberFinance {
  membership_id: UUID;
  chapter_id: UUID;
  charged_cents: number;
  paid_cents: number;
  balance_cents: number;
  dues_state: DuesState;
}

// Backed by the chapter_stats view.
export interface ChapterStats {
  chapter_id: UUID;
  active_members: number;
  total_members: number;
  paid_count: number;
  partial_count: number;
  due_count: number;
  collected_cents: number;
  target_cents: number;
  avg_attendance_pct: number;
}

// An event enriched with its RSVP rollup, for the events screen / dashboard.
export interface EventWithRsvps extends EventRow {
  rsvp_count: number;
  // typeLabel / typeStyle / dateMonth / dateDay are pure presentation —
  // compute them in the component, exactly like the prototype did.
}

export interface AnnouncementWithCounts extends Announcement {
  author_name: string | null;
  author_position: string | null;
  reaction_count: number;
  comment_count: number;
}

// ---------------------------------------------------------------------------
// Presentation helpers — UI-only, ported from the prototype. Keep these OUT
// of the data layer; they take derived rows and return display strings.
// ---------------------------------------------------------------------------
export const money = (cents: number): string => '$' + (cents / 100).toLocaleString();

export const initials = (name: string): string =>
  name.split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

export function duesLabel(state: DuesState): string {
  return state === 'paid' ? 'Paid' : state === 'partial' ? 'Partial' : 'Due';
}
