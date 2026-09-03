// Reading a roster CSV and working out what would change.
//
//   npx tsx scripts/check-roster.ts
//
// The case that matters most is the quiet one: a brother whose name is spelled
// differently on the new sheet must land on his EXISTING record, not arrive as a
// second person — otherwise his payments and every learned sender name are
// stranded on a record the replace is about to delete.

import { buildRosterPlan, readRosterCsv } from '../lib/roster-csv';
import { ROSTER } from '../lib/roster';
import type { MemberRow } from '../lib/types';

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

const members: MemberRow[] = ROSTER.map((r, i) => ({
  id: `m${i + 1}`, name: r.name, aka: [], photoUrl: null, financialAid: false,
}));

const named = (n: string) => members.find((m) => m.name === n)!;

function main() {
  /* ---- the file ---- */
  const csv = [
    'name,financial_aid',
    'Joshua Koch,no',
    'Sam Shors,yes',
    '"Cahilly, Lundeen",',          // quoted, comma inside the name
    'GRAHAM JOHNSTONE,YES',         // shouting
    'Zachary  Ewing ,n',            // stray whitespace
    ',yes',                         // no name
    'Joshua Koch,no',               // duplicate
    'Wednesday Addams,no',          // nobody
  ].join('\n');

  const read = readRosterCsv(csv);
  console.log(`read ${read.rows.length} names, skipped ${read.skipped.length}`);
  read.skipped.forEach((s) => console.log(`  line ${s.line}: ${s.reason}`));
  console.log();

  check('a header row is recognised', read.hadHeader);
  check('a quoted name containing a comma survives',
    read.rows.some((r) => r.name === 'Cahilly, Lundeen'));
  check('financial aid is read', read.rows.find((r) => r.name === 'Sam Shors')!.financialAid);
  check('blank aid means no aid',
    read.rows.find((r) => r.name === 'Cahilly, Lundeen')!.financialAid === false);
  check('a row with no name is skipped', read.skipped.some((s) => s.reason.includes('no name')));
  check('a duplicate is skipped once, not imported twice',
    read.rows.filter((r) => r.name === 'Joshua Koch').length === 1);

  /* ---- replace ---- */
  const plan = buildRosterPlan(read.rows, members, 'replace');
  console.log(`\nreplace: keep ${plan.kept.length}, add ${plan.added.length}, `
    + `remove ${plan.removed.length}, aid changes ${plan.aidChanges.length}`);
  plan.kept.forEach((k) => console.log(
    `  "${k.row.name}" → ${k.member.name}${k.score < 1 ? ` (${k.score.toFixed(2)})` : ''}`,
  ));

  check('an exact name keeps its existing record',
    plan.kept.some((k) => k.member.id === named('Joshua Koch').id));
  check('a shouted name keeps its existing record',
    plan.kept.some((k) => k.member.id === named('Graham Johnstone').id),
    'arriving as a new brother would strand his payments on the record about to be deleted');
  check('"Surname, First" keeps its existing record',
    plan.kept.some((k) => k.member.id === named('Lundeen Cahilly').id));
  check('a name nobody has is added, not matched',
    plan.added.some((r) => r.name === 'Wednesday Addams'));
  check('one brother is never claimed twice',
    new Set(plan.kept.map((k) => k.member.id)).size === plan.kept.length);
  check('everyone absent from the file is removed',
    plan.removed.length === members.length - plan.kept.length);
  check('the aid column drives the flag',
    plan.aidChanges.some((c) => c.member.id === named('Sam Shors').id && c.financialAid));

  /* ---- pledge class: additive, never destructive ---- */
  const pledges = readRosterCsv('name\nWednesday Addams\nPugsley Addams');
  const add = buildRosterPlan(pledges.rows, members, 'pledges');
  console.log(`\npledges: keep ${add.kept.length}, add ${add.added.length}, remove ${add.removed.length}`);
  check('a pledge import removes nobody', add.removed.length === 0,
    'the sheet is a few new names, not a statement about who else exists');
  check('a pledge import adds the new names', add.added.length === 2);

  /* ---- a bare list of names, no header ---- */
  const bare = readRosterCsv('Joshua Koch\nSam Shors');
  check('a bare one-column list works', !bare.hadHeader && bare.rows.length === 2);

  console.log(failures ? `\n${failures} FAILED` : '\nall roster checks ok');
  process.exit(failures ? 1 : 0);
}

main();
