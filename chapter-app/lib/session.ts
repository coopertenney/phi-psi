import type { MemberRow } from './types';
import type { Persona } from './nav';
import { CURRENT_QUARTER, type Quarter } from './calendar';

// Re-export the quarter calendar so existing `@/lib/session` imports keep working.
export { CURRENT_QUARTER, CURRENT_QUARTER_LABEL, CURRENT_ACADEMIC_YEAR } from './calendar';
export type { Quarter } from './calendar';

// Mock identity behind the topbar persona switcher. In live mode this comes from
// the authenticated session (profiles.auth_user_id → membership); for now it
// mirrors the demo users surfaced in the topbar. `admin` is reserved for the
// President/VP; `new` is a new-member persona used to demo tab access.
export const MOCK_USER: Record<Persona, { name: string; title: string }> = {
  admin: { name: 'Eddy Duran', title: 'President' },
  exec: { name: 'Zachary Ewing', title: 'Treasurer' },
  member: { name: 'Sam Cousins', title: 'Brother' },
  new: { name: 'Tyler Rubenstein', title: 'New member' },
};

// Resolve the current member's roster row for a persona. Used by the member
// views (Dashboard, Finances) to show "your" data without exposing the roster.
export const currentMember = (members: MemberRow[], persona: Persona): MemberRow | undefined =>
  members.find((m) => m.fullName === MOCK_USER[persona].name);

/* ─────────────────────────── Dues: quarter system ───────────────────────────
   The chapter is on quarters. A fresh dues charge posts every quarter and stays
   owed until paid — Fall and Winter are $537, Spring is $250. The active quarter
   (and its label) come from the quarter calendar, derived from the demo clock.
   duesFor() derives a member's standing for the active quarter from their state. */

export const QUARTER_DUES_CENTS: Record<Quarter, number> = {
  fall: 53700,
  winter: 53700,
  spring: 30000,
};

export const currentDuesCents = QUARTER_DUES_CENTS[CURRENT_QUARTER];

// What a member owes / has paid for the active quarter, from their dues state.
export function duesFor(m: MemberRow): { charged: number; paid: number; balance: number } {
  const charged = currentDuesCents;
  const balance =
    m.duesState === 'paid' ? 0 : m.duesState === 'partial' ? Math.round(charged / 2) : charged;
  return { charged, paid: charged - balance, balance };
}

/* ─────────────────────────── Fines ───────────────────────────
   Standards-board fines, separate from dues. Mock-derived from a member's
   record so the data is stable; in live mode these come from a `fines` table
   (read = self/exec, write = exec). */

export type Fine = { id: string; label: string; amountCents: number; when: string; paid: boolean };

export function finesFor(m: MemberRow): Fine[] {
  const out: Fine[] = [];
  const id = (n: number) => `${m.membershipId}-f${n}`;
  if (m.attendancePct < 95) out.push({ id: id(1), label: 'Missed chapter meeting', amountCents: 2500, when: 'Apr 7', paid: false });
  if (m.duesState === 'due') out.push({ id: id(2), label: 'Late dues fee', amountCents: 1500, when: 'Apr 5', paid: false });
  if (m.attendancePct < 80) out.push({ id: id(3), label: 'Kitchen cleanup miss', amountCents: 1000, when: 'Mar 22', paid: false });
  if (out.length === 0) out.push({ id: id(0), label: 'Late RSVP fee', amountCents: 1000, when: 'Feb 14', paid: true });
  return out;
}

export const finesOutstanding = (m: MemberRow): number =>
  finesFor(m).filter((f) => !f.paid).reduce((a, f) => a + f.amountCents, 0);

export type LedgerEntry = { kind: 'charge' | 'payment'; label: string; amountCents: number; when: string };

// Per-quarter ledger. Shows the active quarter's charge (+ any payment toward
// it) on top, with the two prior quarters settled — making the recurring,
// pay-each-quarter cadence visible.
export function quarterLedger(m: MemberRow): LedgerEntry[] {
  const { paid } = duesFor(m);
  const spring: LedgerEntry[] = [
    { kind: 'charge', label: 'Spring quarter dues', amountCents: QUARTER_DUES_CENTS.spring, when: 'Apr 1' },
  ];
  if (paid > 0) spring.unshift({ kind: 'payment', label: 'Payment received', amountCents: paid, when: 'Apr 9' });
  return [
    ...spring,
    { kind: 'payment', label: 'Winter quarter dues — paid', amountCents: QUARTER_DUES_CENTS.winter, when: 'Jan 10' },
    { kind: 'payment', label: 'Fall quarter dues — paid', amountCents: QUARTER_DUES_CENTS.fall, when: 'Sep 28' },
  ];
}
