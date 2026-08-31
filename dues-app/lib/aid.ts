// Turning a pasted list of names into roster members.
//
// The treasurer's financial-aid list comes out of a spreadsheet or an email, so
// the names arrive in whatever form a person typed them: "Bobby Chen", "Chen,
// Robert", "graham johnstone". The same matcher that reads bank descriptors
// handles that, and for the same reason — a name is not a key.
//
// Nothing here is guessed silently. A line that lands on two brothers, or on
// nobody, is reported back rather than resolved, because flagging the wrong
// person means somebody stops being asked to pay.

import { nameTokens, scoreName } from './match';
import type { MemberRow } from './types';

export interface NameMatch {
  line: string;
  member: MemberRow;
  score: number;
}

export interface AmbiguousName {
  line: string;
  candidates: MemberRow[];
}

export interface ResolvedNames {
  matched: NameMatch[];
  ambiguous: AmbiguousName[];
  unmatched: string[];
}

const CONFIDENT = 0.9;
const TIE_GAP = 0.05;

/** Splits pasted text into candidate names: one per line, commas tolerated. */
export function splitNames(text: string): string[] {
  return text
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    // "Chen, Robert" is one name; "Chen, Robert, Graham Johnstone" is not a
    // shape worth guessing at, so only a single comma is treated as a swap.
    .map((line) => {
      const parts = line.split(',').map((p) => p.trim()).filter(Boolean);
      return parts.length === 2 ? `${parts[1]} ${parts[0]}` : line;
    })
    .filter((line) => line.length > 0 && nameTokens(line).length > 0);
}

export function resolveNames(text: string, members: MemberRow[]): ResolvedNames {
  const matched: NameMatch[] = [];
  const ambiguous: AmbiguousName[] = [];
  const unmatched: string[] = [];

  splitNames(text).forEach((line) => {
    const scored = members
      .map((m) => ({ member: m, score: scoreName(line, m.name).score }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score < CONFIDENT) { unmatched.push(line); return; }

    const tied = scored.filter((x) => best.score - x.score <= TIE_GAP);
    if (tied.length > 1) {
      ambiguous.push({ line, candidates: tied.map((x) => x.member) });
      return;
    }
    matched.push({ line, member: best.member, score: best.score });
  });

  return { matched, ambiguous, unmatched };
}
