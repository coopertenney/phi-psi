export type UUID = string;

export interface Roster {
  id: UUID;
  name: string;
  created_at: string;
}

export interface Person {
  id: UUID;
  roster_id: UUID;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface Session {
  id: UUID;
  roster_id: UUID;
  date: string; // YYYY-MM-DD
  label: string | null;
  created_at: string;
}

export type AttendanceStatus = 'present' | 'absent' | null;

export interface Attendance {
  id: UUID;
  session_id: UUID;
  person_id: UUID;
  status: AttendanceStatus;
  excused: boolean;
  arrived_late: boolean;
  left_early: boolean;
  arrival_time: string | null; // HH:MM:SS
  departure_time: string | null;
  updated_at: string;
}

export interface ExcusalRule {
  id: UUID;
  person_id: UUID;
  day_of_week: number; // 0-6, 0 = Sunday
  reason: string | null;
  start_date: string;
  end_date: string | null;
}

export interface StudyAbroadPeriod {
  id: UUID;
  person_id: UUID;
  start_date: string;
  end_date: string;
  reason: string | null;
}

/** Person joined with today's attendance row, for the roll call screen. */
export interface RollCallRow {
  person: Person;
  attendance: Attendance;
}
