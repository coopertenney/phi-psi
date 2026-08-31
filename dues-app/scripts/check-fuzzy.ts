// What the matcher can and cannot do, as a list of real descriptor shapes.
// Each case asserts which brother should come out on top and how confident the
// app is allowed to be about it. `npx tsx scripts/check-fuzzy.ts`
//
// The cases that must NOT resolve matter as much as the ones that must: a
// matcher that guesses between two brothers with the same surname is worse than
// one that asks.

import { buildIndex, rankCredit } from '../lib/match';
import { ROSTER } from '../lib/roster';
import type { BankTxn, MemberRow, NameAlias } from '../lib/types';

const members: MemberRow[] = ROSTER.map((r, i) => ({
  id: `m${i + 1}`, name: r.name, aka: [], photoUrl: null, financialAid: false,
}));
const byName = (name: string) => {
  const m = members.find((x) => x.name === name);
  if (!m) throw new Error(`roster has no "${name}"`);
  return m;
};

const DUES = 45000;

interface Case {
  what: string;
  descriptor: string;
  /** Roster name that must rank first, or null when nothing should. */
  expect: string | null;
  /** Lowest acceptable tier: 'clear' means it must be confident. */
  tier?: 'clear' | 'check' | 'unclear' | 'return';
  amountCents?: number;
  aliases?: { bankName: string; memberName: string }[];
}

// Chosen from the live roster so the cases stay honest about real names.
const exact = members.find((m) => m.name === 'Joshua Koch') ?? members[0];
const nick = members.find((m) => m.name === 'Sam Shors') ?? members[1];
const long = members.find((m) => m.name === 'Graham Johnstone') ?? members[2];
const solo = members.find((m) => m.name === 'Saul Hernandez Vigil') ?? members[3];

const CASES: Case[] = [
  {
    what: 'exact name',
    descriptor: `ZELLE PMT FROM ${exact.name.toUpperCase()}`,
    expect: exact.name, tier: 'clear',
  },
  {
    what: 'legal name with middle initial and suffix',
    descriptor: 'ZELLE PMT FROM SAMUEL M SHORS JR',
    expect: nick.name, tier: 'clear',
  },
  {
    what: 'surname truncated by the descriptor field',
    descriptor: 'ZELLE PMT FROM GRAHAM JOHNST',
    expect: long.name, tier: 'clear',
  },
  {
    what: 'one transposed letter in the surname',
    descriptor: 'ZELLE PMT FROM GRAHAM JOHNSTONE'.replace('JOHNSTONE', 'JOHNSTNOE'),
    expect: long.name, tier: 'clear',
  },
  {
    what: 'spelled by ear — same sound, different letters',
    descriptor: 'ZELLE PMT FROM GRAHAM JOHNSTOAN',
    expect: long.name, tier: 'clear',
  },
  {
    what: 'surname first, given name second',
    descriptor: 'ZELLE INSTANT PMT FROM JOHNSTONE GRAHAM REF #4471A',
    expect: long.name, tier: 'clear',
  },
  {
    what: 'a parent — right surname, a first name nobody on the roster has',
    descriptor: `ZELLE PMT FROM LINDA ${solo.name.split(' ').slice(-1)[0].toUpperCase()}`,
    expect: solo.name, tier: 'check',
  },
  {
    what: 'a second parent, after the first was confirmed',
    descriptor: `ZELLE PMT FROM ROBERT ${solo.name.split(' ').slice(-1)[0].toUpperCase()}`,
    expect: solo.name, tier: 'check',
    aliases: [{ bankName: `LINDA ${solo.name.split(' ').slice(-1)[0].toUpperCase()}`, memberName: solo.name }],
  },
  {
    what: 'a confirmed alias beats everything the scorer can infer',
    descriptor: 'ZELLE PMT FROM L M MARSHALL',
    expect: exact.name, tier: 'clear',
    aliases: [{ bankName: 'L M MARSHALL', memberName: exact.name }],
  },
  {
    what: 'not a person at all',
    descriptor: 'MOBILE DEPOSIT — CHECK 2214',
    expect: null, tier: 'unclear', amountCents: 12000,
  },
];

let failures = 0;
const aliasRows = (spec: Case['aliases']): NameAlias[] => (spec ?? []).map((a, i) => ({
  id: `a${i}`, bankName: a.bankName, memberId: byName(a.memberName).id,
  createdBy: 'test', createdAt: '2026-10-01T00:00:00Z',
}));

CASES.forEach((c, i) => {
  const aliases = aliasRows(c.aliases);
  const txn: BankTxn = {
    id: `t${i}`, providerTxnId: null, pendingTxnId: null, accountId: null,
    postedOn: '2026-10-02', amountCents: c.amountCents ?? DUES,
    rawDescription: c.descriptor, pending: false, removedAt: null, amountChangedAt: null,
    source: 'plaid', status: 'queued', enteredBy: 'test',
  };
  // Everyone owes exactly the term charge, which is the real situation: with 105
  // brothers billed the same amount, the amount barely disambiguates and the
  // name is doing nearly all the work.
  const outstanding = Object.fromEntries(members.map((m) => [m.id, DUES]));
  const item = rankCredit({
    txn, members, aliases, outstandingByMember: outstanding, duesCents: DUES,
    index: buildIndex(members, aliases),
  });

  const top = item.candidates[0];
  const gotName = top?.memberName ?? null;
  const nameOk = c.expect === null ? top === undefined || item.tier === 'unclear' : gotName === c.expect;
  const tierOk = !c.tier || item.tier === c.tier;
  const ok = nameOk && tierOk;
  if (!ok) failures++;

  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${c.what}`);
  console.log(`      "${c.descriptor}"`);
  console.log(`      → ${gotName ?? 'nobody'}${top ? ` (${top.score.toFixed(2)})` : ''} [${item.tier}]`
    + `${c.tier && item.tier !== c.tier ? ` — expected ${c.tier}` : ''}`);
  if (!nameOk) console.log(`      expected ${c.expect ?? 'nobody'}`);
  console.log(`      ${item.reason}\n`);
});

/* ---- and the ones it must refuse ---- */

const surnameGroups = new Map<string, MemberRow[]>();
members.forEach((m) => {
  const key = m.name.split(' ').slice(-1)[0].toUpperCase();
  surnameGroups.set(key, [...(surnameGroups.get(key) ?? []), m]);
});
// The tie only exists when two brothers share a surname *and* a first initial —
// two Lees with different initials are separable, and the matcher should say so.
const shared = [...surnameGroups.entries()]
  .find(([, g]) => g.length >= 2 && g[0].name[0].toUpperCase() === g[1].name[0].toUpperCase());

if (!shared) console.log('note: no two brothers share a surname and an initial — tie cases skipped\n');

if (shared) {
  const [surnameKey, group] = shared;
  const txn: BankTxn = {
    id: 'tie', providerTxnId: null, pendingTxnId: null, accountId: null,
    postedOn: '2026-10-02', amountCents: DUES,
    rawDescription: `ZELLE PMT FROM ${group[0].name[0].toUpperCase()} ${surnameKey}`,
    pending: false, removedAt: null, amountChangedAt: null,
    source: 'plaid', status: 'queued', enteredBy: 'test',
  };
  const outstanding = Object.fromEntries(members.map((m) => [m.id, DUES]));
  const item = rankCredit({
    txn, members, aliases: [], outstandingByMember: outstanding, duesCents: DUES,
  });
  const ok = item.tied && item.tier === 'unclear';
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  two brothers fit and both owe the same — must refuse to guess`);
  console.log(`      "${txn.rawDescription}"\n      ${item.reason}\n`);

  // Same descriptor, but only one of them still owes this amount: that's a real
  // signal, and using it removes a queue item a human would resolve identically.
  const oneFits = { ...outstanding, [group[1].id]: 20000 };
  const broken = rankCredit({
    txn, members, aliases: [], outstandingByMember: oneFits, duesCents: DUES,
  });
  const brokenOk = !broken.tied && broken.candidates[0]?.memberId === group[0].id;
  if (!brokenOk) failures++;
  console.log(`${brokenOk ? 'ok  ' : 'FAIL'}  ...unless the amount separates them`);
  console.log(`      ${broken.reason}\n`);
}

console.log(failures ? `${failures} FAILED` : 'all cases ok');
process.exit(failures ? 1 : 0);
