import type { PnmStage, PnmNote } from './types';
import type { BadgeTone } from './format';
import { NOW, seededUnit } from './engagement';

/* ─────────────────────────── Pipeline stages ───────────────────────────
   The forward rush funnel, in order. `declined` is a terminal off-ramp kept out
   of the funnel (a PNM can be passed at any stage). */

export const FUNNEL: { id: PnmStage; label: string; short: string }[] = [
  { id: 'prospect', label: 'Prospect', short: 'Prospect' },
  { id: 'invited', label: 'Invited to rush', short: 'Invited' },
  { id: 'interview', label: 'Interviewed', short: 'Interview' },
  { id: 'voting', label: 'Up for vote', short: 'Voting' },
  { id: 'bid', label: 'Bid extended', short: 'Bid' },
  { id: 'accepted', label: 'Accepted bid', short: 'Accepted' },
];

export const STAGE_META: Record<PnmStage, { label: string; short: string; tone: BadgeTone }> = {
  prospect: { label: 'Prospect', short: 'Prospect', tone: 'neutral' },
  invited: { label: 'Invited to rush', short: 'Invited', tone: 'info' },
  interview: { label: 'Interviewed', short: 'Interview', tone: 'info' },
  voting: { label: 'Up for vote', short: 'Voting', tone: 'warning' },
  bid: { label: 'Bid extended', short: 'Bid', tone: 'success' },
  accepted: { label: 'Accepted bid', short: 'Accepted', tone: 'success' },
  declined: { label: 'Declined', short: 'Declined', tone: 'danger' },
};

const FUNNEL_IDS = FUNNEL.map((s) => s.id);

// Next stage in the funnel, or null at the end. `declined` has no next.
export const nextStage = (stage: PnmStage): PnmStage | null => {
  const i = FUNNEL_IDS.indexOf(stage);
  return i >= 0 && i < FUNNEL_IDS.length - 1 ? FUNNEL_IDS[i + 1] : null;
};

export const stageIndex = (stage: PnmStage): number => FUNNEL_IDS.indexOf(stage);

/* ─────────────────────────── Notes ───────────────────────────
   Deterministic note thread per PNM, drawn from a template pool and attributed
   to brothers — so the mock is stable and the detail view feels populated.
   In live mode this is the pnm_notes table (written by any brother). */

const NOTE_AUTHORS = ['Marcus Chen', 'Tyler Brooks', 'Diego Ramirez', 'Aisha Patel', 'Jordan Avery', 'Noah Williams'];

const NOTE_POOL = [
  'Great conversation at the BBQ — clearly looking for a tight-knit group.',
  'Strong academically, wants to get involved in philanthropy. Good culture fit.',
  'A little quiet one-on-one but lit up in the group setting. Worth a callback.',
  'Came to two events already, very engaged. Knows a few brothers from his dorm.',
  'Solid guy. Asked good questions about the time commitment and dues.',
  'Referred by a brother and it shows — already feels like one of us.',
  'On the fence about rushing — keep him warm, invite to the next social.',
  'Impressive resume, rushing a couple houses. We should prioritize him.',
];

export function pnmNotes(pnmId: string, count: number): PnmNote[] {
  const n = Math.min(count, 4);
  return Array.from({ length: n }, (_, i) => {
    const author = NOTE_AUTHORS[Math.floor(seededUnit(`${pnmId}-na${i}`) * NOTE_AUTHORS.length)];
    const text = NOTE_POOL[Math.floor(seededUnit(`${pnmId}-nt${i}`) * NOTE_POOL.length)];
    const d = new Date(NOW);
    d.setDate(d.getDate() - (i + 1) * 2 - Math.floor(seededUnit(`${pnmId}-nd${i}`) * 3));
    return { id: `${pnmId}-note-${i}`, author, text, when: d.toISOString() };
  });
}

// 5-star display split (full / empty) for an average rating.
export const stars = (rating: number): { full: number; half: boolean; empty: number } => {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return { full, half, empty: 5 - full - (half ? 1 : 0) };
};
