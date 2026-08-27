// The walkthrough from `../dues-desk.html`, rebuilt against the real roster.
// Every case here is one the review queue has to survive: an exact match, a
// legal name, a parent, two brothers who fit the same truncated name, a
// partial, a payment covering two people, a credit that isn't dues, and a
// reversal. Used to exercise the matcher on localhost; never seeded live.

import type { RecordCreditInput } from './backend';
import type { MemberRow } from './types';
import { formalFor, nameTokens } from './match';

const surname = (name: string) => {
  const t = nameTokens(name);
  return t[t.length - 1] ?? name.toUpperCase();
};
const given = (name: string) => nameTokens(name)[0] ?? name.toUpperCase();

// Day offsets from a fixed start, so the sample is deterministic.
const day = (start: string, offset: number) => {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

export interface SampleWalkthrough {
  credits: RecordCreditInput[];
  /** The brother whose already-applied payment the reversal case comes back on. */
  returnedMemberId: string | null;
}

export function buildSampleCredits(
  members: MemberRow[],
  duesCents: number,
  startDate: string,
): SampleWalkthrough {
  if (members.length < 6) return { credits: [], returnedMemberId: null };

  // Two brothers who share a surname, or failing that a first initial — the
  // tie case only means something if the roster actually contains one.
  let tiedPair: [MemberRow, MemberRow] | null = null;
  for (let i = 0; i < members.length && !tiedPair; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i];
      const b = members[j];
      if (surname(a.name) === surname(b.name) && given(a.name)[0] === given(b.name)[0]) {
        tiedPair = [a, b];
        break;
      }
    }
  }

  // The legal-name case only teaches anything if the brother actually goes by a
  // nickname — "Alex" paying as "ALEXANDER M …" is the divergence to exercise.
  const nicknamed = members.find((m) => !tiedPair?.some((t) => t.id === m.id) && formalFor(given(m.name)));

  const used = new Set([
    ...(tiedPair ? [tiedPair[0].id, tiedPair[1].id] : []),
    ...(nicknamed ? [nicknamed.id] : []),
  ]);
  const pick = (n: number) => members.filter((m) => !used.has(m.id)).slice(0, n);
  const [exact, fallbackLegal, parent, partial, doubled, returned] = pick(6);
  [exact, fallbackLegal, parent, partial, doubled, returned].forEach((m) => used.add(m.id));
  const legal = nicknamed ?? fallbackLegal;
  const legalGiven = formalFor(given(legal.name)) ?? given(legal.name);

  const credits: RecordCreditInput[] = [
    {
      rawDescription: `ZELLE PMT FROM ${given(exact.name)} ${surname(exact.name)}`,
      amountCents: duesCents,
      postedOn: day(startDate, 0),
      pending: false,
    },
    {
      // Middle initial + suffix: the shape a legal name arrives in.
      rawDescription: `ZELLE PMT FROM ${legalGiven} M ${surname(legal.name)} JR`,
      amountCents: duesCents,
      postedOn: day(startDate, 0),
      pending: false,
    },
    {
      // A parent: right surname, a given name nobody on the roster has.
      rawDescription: `ZELLE PMT FROM LINDA ${surname(parent.name)}`,
      amountCents: duesCents,
      postedOn: day(startDate, 1),
      pending: false,
    },
    {
      rawDescription: `ZELLE PMT FROM ${given(partial.name)} ${surname(partial.name)}`,
      amountCents: Math.round(duesCents * 0.45),
      postedOn: day(startDate, 2),
      pending: false,
    },
    {
      rawDescription: `ZELLE PMT FROM ${given(doubled.name)} ${surname(doubled.name)}`,
      amountCents: duesCents * 2,
      postedOn: day(startDate, 2),
      pending: false,
    },
    {
      rawDescription: 'MOBILE DEPOSIT — CHECK 2214',
      amountCents: 12000,
      postedOn: day(startDate, 3),
      pending: false,
    },
    {
      rawDescription: `ZELLE RETURN — ${given(returned.name)[0]} ${surname(returned.name)}`,
      amountCents: -duesCents,
      postedOn: day(startDate, 3),
      pending: false,
    },
  ];

  if (tiedPair) {
    credits.splice(3, 0, {
      rawDescription: `ZELLE PMT FROM ${given(tiedPair[0].name)[0]} ${surname(tiedPair[0].name)}`,
      amountCents: duesCents,
      postedOn: day(startDate, 1),
      pending: false,
    });
  }

  return { credits, returnedMemberId: returned.id };
}
