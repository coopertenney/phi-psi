import { Attendance, AttendanceStatus, ExcusalRule, Person, StudyAbroadPeriod } from './types';

/** True if `date` (YYYY-MM-DD) falls inside any of the person's study-abroad ranges. */
export function isStudyAbroad(
  personId: string,
  date: string,
  periods: StudyAbroadPeriod[]
): boolean {
  return periods.some(
    (p) => p.person_id === personId && date >= p.start_date && date <= p.end_date
  );
}

/** Returns the active excusal rule for this person/date, if any. */
export function findActiveExcusalRule(
  personId: string,
  date: string,
  dayOfWeek: number,
  rules: ExcusalRule[]
): ExcusalRule | undefined {
  return rules.find(
    (r) =>
      r.person_id === personId &&
      r.day_of_week === dayOfWeek &&
      date >= r.start_date &&
      (r.end_date === null || date <= r.end_date)
  );
}

export interface InitialAttendanceSeed {
  person_id: string;
  status: AttendanceStatus;
  excused: boolean;
}

/**
 * Computes the initial attendance rows for a new session:
 * study-abroad people are dropped entirely; everyone else gets
 * pre-filled excused/absent if a recurring excusal rule matches today,
 * otherwise unmarked.
 */
export function buildInitialAttendanceSeeds(
  people: Person[],
  date: string,
  studyAbroadPeriods: StudyAbroadPeriod[],
  excusalRules: ExcusalRule[]
): InitialAttendanceSeed[] {
  const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
  return people
    .filter((p) => !isStudyAbroad(p.id, date, studyAbroadPeriods))
    .map((p) => {
      const rule = findActiveExcusalRule(p.id, date, dayOfWeek, excusalRules);
      return rule
        ? { person_id: p.id, status: 'absent' as const, excused: true }
        : { person_id: p.id, status: null, excused: false };
    });
}

export interface AttendanceUpdate {
  status: AttendanceStatus;
  excused: boolean;
  arrived_late: boolean;
  left_early: boolean;
  arrival_time: string | null;
  departure_time: string | null;
}

/**
 * Tap-cycle for the main roll call screen: unmarked -> present -> absent -> unmarked.
 * Special case: a pre-filled excused-absent row flips straight to present on one tap
 * (person showed up after all) and clears the excused flag.
 * Leaving 'present' always clears late/early modifiers set in review mode.
 */
export function nextAttendanceState(current: Attendance): AttendanceUpdate {
  const cleared = {
    arrived_late: false,
    left_early: false,
    arrival_time: null,
    departure_time: null,
  };

  if (current.status === 'absent' && current.excused) {
    return { status: 'present', excused: false, ...cleared };
  }
  if (current.status === null) {
    return { status: 'present', excused: false, ...cleared };
  }
  if (current.status === 'present') {
    return { status: 'absent', excused: false, ...cleared };
  }
  // status === 'absent' && !excused
  return { status: null, excused: false, ...cleared };
}

/** present sessions / total eligible sessions (study-abroad-excluded sessions never get a row). */
export function computeAttendancePercent(rows: Attendance[]): number | null {
  if (rows.length === 0) return null;
  const present = rows.filter((r) => r.status === 'present').length;
  return present / rows.length;
}
