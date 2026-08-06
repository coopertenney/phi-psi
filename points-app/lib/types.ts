// UI-facing types for the standalone Points & Attendance app. No members/
// dues/finances/recruitment concepts — see phi-psi-points-app-spec.md.

export type PointKind = 'reward' | 'punishment';

// Per-meeting mark. 'abroad' also stands in for the standing member_term_status.
// Attendance % = present / (present + absent); late/excused/abroad are neutral.
export type AttendanceState = 'present' | 'late' | 'absent' | 'excused' | 'abroad';

export interface MemberRow {
  id: string;
  name: string;
  photoUrl: string | null;
}

export interface PointItem {
  id: string;
  label: string;
  points: number;                      // catalog value; 0 when discretionary
  kind: PointKind;
  discretionary: boolean;              // exec sets the value per entry
  archived: boolean;
  sortOrder: number;
  maxPerTerm: number | null;           // per-member cap per term; null = unlimited
  autoTrigger: AttendanceState | null; // auto-award on this attendance state; null = manual
}

export interface PointEntry {
  id: string;
  memberId: string;
  itemId: string;
  label: string;       // joined from point_items, for display
  points: number;
  loggedBy: string;
  termId: string | null;
  meetingId: string | null;
  createdAt: string;   // ISO
}

export interface ScoreConfig {
  floor: number;
  ceiling: number | null;
}

export interface Term {
  id: string;
  label: string;
  isCurrent: boolean;
}

export interface MeetingRow {
  id: string;
  title: string;
  heldOn: string; // ISO date
  termId: string | null;
}

export type TermStatusKind = 'abroad' | 'excused';
export interface MemberTermStatus {
  memberId: string;
  kind: TermStatusKind;
  reason: string | null;
}
