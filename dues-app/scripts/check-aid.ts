// The financial-aid flag and the name resolver.
//
//   npx tsx scripts/check-aid.ts
//
// Two things are asserted, and the second matters more than the first: that the
// flag changes who gets chased, and that it changes NOTHING about the money. A
// flag that quietly reduced what someone owed would make "collected" stop
// meaning money that actually arrived.

import { resolveNames, splitNames } from '../lib/aid';
import { buildDesk } from '../lib/ledger';
import { mockBackend } from '../lib/mock-store';
import { formatCents } from '../lib/money';

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const snap0 = await mockBackend.getSnapshot();
  const members = snap0.members;

  /* ---- the resolver ---- */
  const exact = members.find((m) => m.name === 'Joshua Koch')!;
  const nick = members.find((m) => m.name === 'Sam Shors')!;
  // Two brothers who share a surname, for the ambiguous case.
  const bySurname = new Map<string, string[]>();
  members.forEach((m) => {
    const k = m.name.split(' ').slice(-1)[0];
    bySurname.set(k, [...(bySurname.get(k) ?? []), m.name]);
  });
  const shared = [...bySurname.entries()].find(([, g]) => g.length >= 2)!;

  const pasted = [
    exact.name,                                   // exact
    `SAMUEL SHORS`,                               // formal name for a nickname
    `${exact.name.split(' ')[1]}, ${exact.name.split(' ')[0]}`,  // "Surname, First"
    shared[0],                                    // a bare surname two brothers share
    'Wednesday Addams',                           // nobody
    '',                                           // blank line
  ].join('\n');

  console.log(`pasted ${splitNames(pasted).length} usable lines\n`);
  const res = resolveNames(pasted, members);

  console.log('matched:');
  res.matched.forEach((m) => console.log(`  "${m.line}" → ${m.member.name} (${m.score.toFixed(2)})`));
  console.log('ambiguous:');
  res.ambiguous.forEach((a) => console.log(`  "${a.line}" → ${a.candidates.map((c) => c.name).join(' or ')}`));
  console.log('unmatched:');
  res.unmatched.forEach((u) => console.log(`  "${u}"`));
  console.log();

  check('an exact name resolves', res.matched.some((m) => m.member.id === exact.id));
  check('a formal name resolves to the nickname on the roster',
    res.matched.some((m) => m.member.id === nick.id));
  check('"Surname, First" resolves',
    res.matched.filter((m) => m.member.id === exact.id).length >= 1);
  check('a name nobody has is reported, not guessed',
    res.unmatched.some((u) => u.includes('Addams')));
  check('a surname two brothers share is not silently resolved',
    !res.matched.some((m) => m.line === shared[0])
    || res.ambiguous.some((a) => a.line === shared[0]),
    'flagging the wrong brother stops him being asked to pay, invisibly');
  check('blank lines are ignored', splitNames(pasted).length === 5);

  /* ---- the flag changes who is chased, and nothing else ---- */
  await mockBackend.setTermDues(45000);
  await mockBackend.issueCharges();
  const before = buildDesk(await mockBackend.getSnapshot());

  await mockBackend.setFinancialAid([exact.id], true);
  const after = buildDesk(await mockBackend.getSnapshot());
  const row = after.rows.find((r) => r.memberId === exact.id)!;

  console.log(`\nfollow-up: ${before.summary.followUpCount} → ${after.summary.followUpCount}`);
  console.log(`outstanding: ${formatCents(before.summary.outstandingCents)} → `
    + `${formatCents(after.summary.outstandingCents)}`);
  console.log(`${row.name}: charged ${formatCents(row.chargedCents)} owes ${formatCents(row.balanceCents)} ${row.status}`);

  check('the flag takes him off the follow-up list',
    after.summary.followUpCount === before.summary.followUpCount - 1);
  check('he is still charged', row.chargedCents === 45000);
  check('he still owes', row.balanceCents === 45000 && row.status === 'unpaid');
  check('the chapter\'s outstanding total does not move',
    after.summary.outstandingCents === before.summary.outstandingCents,
    'the money is still owed — the flag only says not to chase him');
  check('collected does not move',
    after.summary.collectedCents === before.summary.collectedCents);
  check('he is counted on the aid list', after.summary.aidCount === 1);

  await mockBackend.setFinancialAid([exact.id], false);
  const cleared = buildDesk(await mockBackend.getSnapshot());
  check('removing the flag puts him back on the follow-up list',
    cleared.summary.followUpCount === before.summary.followUpCount);

  /* ---- abroad: a real exemption, not a flag ---- */
  console.log('\n--- abroad ---');
  const traveller = members.find((m) => m.name === 'Sam Shors')!;
  const beforeAbroad = buildDesk(await mockBackend.getSnapshot());

  await mockBackend.setExempt(traveller.id, 'Madrid, winter quarter');
  const abroad = buildDesk(await mockBackend.getSnapshot());
  const row2 = abroad.rows.find((r) => r.memberId === traveller.id)!;

  console.log(`${row2.name}: charged ${formatCents(row2.chargedCents)} `
    + `owes ${formatCents(row2.balanceCents)} status ${row2.status}`);
  console.log(`outstanding: ${formatCents(beforeAbroad.summary.outstandingCents)} → `
    + `${formatCents(abroad.summary.outstandingCents)}`);

  check('an abroad brother is not charged at all', row2.chargedCents === 0);
  check('he owes nothing', row2.balanceCents === 0);
  check('he reads as abroad, not as paid', row2.status === 'exempt',
    'reading as paid would make the collected figure look like money that arrived');
  check('the charge came off the chapter total',
    abroad.summary.outstandingCents === beforeAbroad.summary.outstandingCents - 45000);
  check('he is off the follow-up list',
    abroad.summary.followUpCount === beforeAbroad.summary.followUpCount - 1);
  check('he is counted as abroad', abroad.summary.exemptCount === 1);

  // Charging the roster again must not re-bill him.
  await mockBackend.issueCharges();
  const recharged = buildDesk(await mockBackend.getSnapshot());
  check('charging the roster again skips him',
    recharged.rows.find((r) => r.memberId === traveller.id)!.chargedCents === 0);

  await mockBackend.removeExempt(traveller.id);
  await mockBackend.issueCharges();
  const back = buildDesk(await mockBackend.getSnapshot());
  const row3 = back.rows.find((r) => r.memberId === traveller.id)!;
  check('unmarking him and re-charging bills him normally',
    row3.chargedCents === 45000 && row3.status === 'unpaid');

  console.log(failures ? `\n${failures} FAILED` : '\nall aid checks ok');
  process.exit(failures ? 1 : 0);
}

main();
