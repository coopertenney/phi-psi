import type { PointEntry } from './types';

/* ─────────────────────────── Points engine ───────────────────────────
   Direct port of the chapter's Google-Sheet accountability tracker. The sheet's
   per-member total is:

     POINTS (tracker)!B =
       MAX( -5,
            SUMIF('POINTS (log)', member)        // Σ approved item points
            - attendance penalty                 // (fast-follow)
            - dues penalty                        // (fast-follow)
            + sigs bonus )                        // (fast-follow)

   The CORE implemented here is the floor + the log sum. The three adjustments
   (attendance/dues/sigs) are the next pass — see TODO(fast-follow) below.

   TODO(fast-follow): when adding the penalties, confirm two quirks with the user
   first (both look like double-counting):
   1. Items like "Missing Chapter -2" / "Late Dues -2" exist in the log catalog
      AND are subtracted again as the attendance(col O)/dues penalties.
   2. The attendance term is ABS(col O) where O = formals×1 - absences×2, so a
      member with more formals than absences still LOSES points — likely a sheet
      bug, not intended logic. */

// Default floor: points can't drop below this, no matter how many punishments
// stack up. The chapter can override it (and add a ceiling) via ScoreConfig.
export const POINT_FLOOR = -5;

// Chapter-configurable scoring bounds (from chapters.points_floor/ceiling).
export interface ScoreConfig {
  floor?: number;
  ceiling?: number | null;
}

export const entriesFor = (entries: PointEntry[], membershipId: string): PointEntry[] =>
  entries.filter((e) => e.membershipId === membershipId);

// Member self-logged entries still awaiting exec approval. Shown in the member's
// own ledger and the exec approvals queue, but excluded from every total below.
export const pendingFor = (entries: PointEntry[], membershipId: string): PointEntry[] =>
  entriesFor(entries, membershipId).filter((e) => e.status === 'pending');

// Only approved entries count toward standing — a pending member request is a
// proposal, not points. Mirrors member_standings' `where status = 'approved'`.
const approved = (entries: PointEntry[]): PointEntry[] => entries.filter((e) => e.status === 'approved');

// A member's standing: the sum of their APPROVED entries, clamped to the
// chapter's floor (and ceiling, if set). Reset-each-term is applied by the
// caller pre-filtering `entries` to the current term — this stays term-agnostic.
export function memberPointTotal(entries: PointEntry[], membershipId: string, cfg: ScoreConfig = {}): number {
  const sum = approved(entriesFor(entries, membershipId)).reduce((a, e) => a + e.points, 0);
  const capped = cfg.ceiling != null ? Math.min(cfg.ceiling, sum) : sum;
  return Math.max(cfg.floor ?? POINT_FLOOR, capped);
}

// Points earned/lost in the trailing 7 days — the site's analog of the sheet's
// week-over-week SNAPSHOT delta, used for the leaderboard's "this week" + the
// "accountable member of the month" (biggest gainer).
export function weekChange(entries: PointEntry[], membershipId: string, now: Date): number {
  const cutoff = now.getTime() - 7 * 86_400_000;
  return approved(entriesFor(entries, membershipId))
    .filter((e) => new Date(e.date).getTime() >= cutoff)
    .reduce((a, e) => a + e.points, 0);
}

// Reward vs punishment split for a member, for the ledger summary. Approved only.
export function rewardPunishmentSplit(entries: PointEntry[], membershipId: string): { reward: number; punishment: number } {
  const mine = approved(entriesFor(entries, membershipId));
  return {
    reward: mine.filter((e) => e.points > 0).reduce((a, e) => a + e.points, 0),
    punishment: mine.filter((e) => e.points < 0).reduce((a, e) => a + e.points, 0),
  };
}
