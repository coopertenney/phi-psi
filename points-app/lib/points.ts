import type { PointEntry, ScoreConfig } from './types';

/* ─────────────────────────── Points engine ───────────────────────────
   Ported from the chapter app's lib/points.ts. This app has no member self-log
   queue, so every points_entries row counts immediately — no 'pending'/'approved'
   status, no filtering by it. A member's total is simply:

     clamp(floor, ceiling, Σ their entries)
*/

export const entriesFor = (entries: PointEntry[], memberId: string): PointEntry[] =>
  entries.filter((e) => e.memberId === memberId);

export function memberPointTotal(entries: PointEntry[], memberId: string, cfg: ScoreConfig): number {
  const sum = entriesFor(entries, memberId).reduce((a, e) => a + e.points, 0);
  const capped = cfg.ceiling != null ? Math.min(cfg.ceiling, sum) : sum;
  return Math.max(cfg.floor, capped);
}

// Points earned/lost in the trailing 7 days — leaderboard's "this week".
export function weekChange(entries: PointEntry[], memberId: string, now: Date): number {
  const cutoff = now.getTime() - 7 * 86_400_000;
  return entriesFor(entries, memberId)
    .filter((e) => new Date(e.createdAt).getTime() >= cutoff)
    .reduce((a, e) => a + e.points, 0);
}

// Reward vs punishment split for a member, for the breakdown view.
export function rewardPunishmentSplit(entries: PointEntry[], memberId: string): { reward: number; punishment: number } {
  const mine = entriesFor(entries, memberId);
  return {
    reward: mine.filter((e) => e.points > 0).reduce((a, e) => a + e.points, 0),
    punishment: mine.filter((e) => e.points < 0).reduce((a, e) => a + e.points, 0),
  };
}

// Attendance % = present / (present + absent). late/excused/abroad are neutral
// (dropped from the denominator). Kept in lockstep with schema.sql's attendance
// check + the chapter app's lib/engagement.ts.
export function attendancePctFrom(states: ('present' | 'late' | 'absent' | 'excused' | 'abroad')[]): number {
  const graded = states.filter((s) => s === 'present' || s === 'absent').length;
  return graded ? Math.round((states.filter((s) => s === 'present').length / graded) * 100) : 0;
}
