import type { DuesState, MemberStatus } from './types';

// Presentation helpers, ported from the prototype. Pure / UI-only.

export const money = (cents: number): string => '$' + (cents / 100).toLocaleString();

export const initials = (name: string): string =>
  name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

// Deterministic avatar tint, same scheme as the prototype.
const TINTS = [
  { bg: 'var(--cardinal-100)', fg: 'var(--cardinal-700)' },
  { bg: 'var(--hunter-100)', fg: 'var(--hunter-700)' },
  { bg: 'var(--info-100)', fg: 'var(--info-600)' },
  { bg: '#EEE6D6', fg: '#8A6D3B' },
];
export const tint = (name: string) => TINTS[(name.charCodeAt(0) || 0) % TINTS.length];

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export function statusBadge(status: MemberStatus): { tone: BadgeTone; label: string } {
  if (status === 'active') return { tone: 'success', label: 'Active' };
  if (status === 'new') return { tone: 'info', label: 'New Member' };
  return { tone: 'neutral', label: 'Inactive' };
}

export function duesBadge(state: DuesState): { tone: BadgeTone; label: string } {
  if (state === 'paid') return { tone: 'success', label: 'Paid' };
  if (state === 'partial') return { tone: 'warning', label: 'Partial' };
  return { tone: 'danger', label: 'Due' };
}

/* ─────────────────────────── Dates ───────────────────────────
   Pure formatters for ISO strings. relativeDay takes the "now" anchor as an
   argument (the app's demo clock lives in lib/engagement) so this stays
   dependency-free. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

export const fmtWeekday = (iso: string): string => WEEKDAYS[new Date(iso).getDay()];

export const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`;
};

// "Today" / "Tomorrow" / "In 3 days" / "2 days ago", relative to a now anchor.
export const relativeDay = (iso: string, now: Date): string => {
  const days = Math.round((new Date(iso).getTime() - now.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return days > 0 ? `In ${days} days` : `${-days} days ago`;
};
