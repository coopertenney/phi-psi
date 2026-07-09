import type { AttendanceState } from './types';

/* ─────────────────────────── Demo clock ───────────────────────────
   We anchor every relative date here instead of real Date.now() so the
   upcoming/past split and "x days ago" copy stay stable regardless of the
   wall clock. */
export const NOW = new Date('2026-07-06T12:00:00');

/* ─────────────────────────── Deterministic noise ───────────────────────────
   Stable 32-bit hash → pseudo-random unit, keyed off ids. Same spirit as the
   duesFor/finesFor derivations in session.ts: the mock never flickers between
   renders, and live mode replaces these with real rows. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const unit = (s: string): number => hash(s) / 0xffffffff; // 0..1

// Shared deterministic 0..1 source, reused by other derivation modules
// (e.g. lib/recruitment.ts) so the whole mock stays stable and DRY.
export const seededUnit = unit;

/* ─────────────────────────── Attendance ───────────────────────────
   A member's attendance across `count` meetings. Exactly round((1-target)·count)
   are missed — so the derived percentage tracks the intended figure — with the
   missed meetings split roughly half excused / half absent. Deterministic by
   salt, so the same member always has the same history. */
export function memberAttendance(salt: string, targetPct: number, count: number): AttendanceState[] {
  const misses = Math.round((1 - targetPct / 100) * count);
  // Rank meeting indices by hash; the top `misses` are the ones skipped.
  const ranked = Array.from({ length: count }, (_, i) => i)
    .sort((a, b) => unit(`${salt}-m${b}`) - unit(`${salt}-m${a}`));
  const missed = new Set(ranked.slice(0, misses));
  return Array.from({ length: count }, (_, i) =>
    missed.has(i) ? (unit(`${salt}-e${i}`) < 0.45 ? 'excused' : 'absent') : 'present',
  );
}

// Attendance % = present / (present + absent). late/excused/abroad are neutral
// (dropped from the denominator). Kept in lockstep with attendance-v2.sql and
// AttendanceScreen's pctFrom.
export const attendancePctFrom = (states: AttendanceState[]): number => {
  const graded = states.filter((s) => s === 'present' || s === 'absent').length;
  return graded ? Math.round((states.filter((s) => s === 'present').length / graded) * 100) : 0;
};
