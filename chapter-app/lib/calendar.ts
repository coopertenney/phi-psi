// Quarter-system calendar. The chapter runs on academic quarters (Stanford-style),
// not semesters, so terms and the academic year are derived from a date rather
// than hardcoded. Everything keys off the demo clock NOW; in live mode the same
// helpers work against the real current date.

import { NOW } from './engagement';

export type Quarter = 'fall' | 'winter' | 'spring';

const Q_LABEL: Record<Quarter, string> = { fall: 'Fall', winter: 'Winter', spring: 'Spring' };

// Quarter a date falls in, by month. Summer (Jul–Aug) is off-term and folds into
// the upcoming Fall. Fall: Sep–Dec · Winter: Jan–Mar · Spring: Apr–Jun.
export function quarterForDate(d: Date): Quarter {
  const m = d.getMonth(); // 0 = Jan
  if (m >= 8) return 'fall';        // Sep–Dec
  if (m <= 2) return 'winter';      // Jan–Mar
  if (m <= 5) return 'spring';      // Apr–Jun
  return 'fall';                    // Jul–Aug → next Fall
}

// e.g. April 2026 → "Spring Quarter 2026".
export const quarterLabel = (d: Date): string => `${Q_LABEL[quarterForDate(d)]} Quarter ${d.getFullYear()}`;

// Academic year a date belongs to. The year rolls over in summer (Jul), so
// April 2026 → "2025–26" while October 2026 → "2026–27".
export function academicYear(d: Date): { startYear: number; label: string } {
  const startYear = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  const end = String((startYear + 1) % 100).padStart(2, '0');
  return { startYear, label: `${startYear}–${end}` };
}

// The academic year that *begins* at the next Fall — what "start a new school
// year" rolls the chapter into. From Spring 2026 that's 2026–27.
export function upcomingAcademicYear(d: Date): { startYear: number; label: string } {
  const startYear = d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear();
  const end = String((startYear + 1) % 100).padStart(2, '0');
  return { startYear, label: `${startYear}–${end}` };
}

// The class graduating at the end of the current academic year (spring grads).
export const graduatingClassYear = (d: Date): number => academicYear(d).startYear + 1;

export const CURRENT_QUARTER: Quarter = quarterForDate(NOW);
export const CURRENT_QUARTER_LABEL: string = quarterLabel(NOW);
export const CURRENT_ACADEMIC_YEAR: string = academicYear(NOW).label;

/* ─────────────────────────── Cyclable term marker ───────────────────────────
   The sidebar's "current term" can be advanced one quarter at a time by an admin
   (President). It's a display marker only — it does NOT re-scope points, dues, or
   attendance (those stay derived from NOW / the seed). A `Term` is the quarter
   plus its calendar year so the label and academic-year both roll correctly on
   the Spring→Fall wrap. Live seam: persist as terms.is_current. */

export interface Term { quarter: Quarter; year: number } // year = calendar year the quarter sits in

export const nextQuarter = (q: Quarter): Quarter =>
  q === 'fall' ? 'winter' : q === 'winter' ? 'spring' : 'fall';

// Advance one quarter. The calendar year rolls forward only on fall→winter (the
// only transition that crosses January).
export function nextTerm(t: Term): Term {
  return { quarter: nextQuarter(t.quarter), year: t.quarter === 'fall' ? t.year + 1 : t.year };
}

export const advanceTerm = (t: Term, n: number): Term => {
  let r = t;
  for (let i = 0; i < n; i++) r = nextTerm(r);
  return r;
};

export const termLabel = (t: Term): string => `${Q_LABEL[t.quarter]} Quarter ${t.year}`;

// Academic year a term belongs to. Fall starts its own year; winter/spring belong
// to the academic year that started the previous fall.
export function termAcademicYear(t: Term): { startYear: number; label: string } {
  const startYear = t.quarter === 'fall' ? t.year : t.year - 1;
  const end = String((startYear + 1) % 100).padStart(2, '0');
  return { startYear, label: `${startYear}–${end}` };
}

// The term the chapter is in today — the baseline the cycle button advances from.
export const BASE_TERM: Term = { quarter: quarterForDate(NOW), year: NOW.getFullYear() };
