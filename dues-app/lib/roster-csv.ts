// Reading a roster CSV, and working out what changes.
//
// Two operations, and only one of them is dangerous:
//
//   replace  — this file IS the roster now. Names on it are kept, names missing
//              from it are deleted, new names are added.
//   pledges  — additive. New names are added, existing ones left alone. Nothing
//              is ever removed.
//
// Deleting a brother takes his payments and charges with him (the database
// cascades), so a replace changes what the chapter recorded as collected in past
// terms, not just who gets billed next term. That is the chapter's call to make,
// but it is never made silently: buildRosterPlan reports exactly what would go,
// and what is attached to each name, before anything is written.

import { normalizeName, scoreName } from './match';
import type { MemberRow } from './types';

/* ─────────────────────────── the file ─────────────────────────── */

/** Minimal RFC 4180 reader — quotes, escaped quotes, CRLF. A surname like
 *  "Smith, Jr." is why the quoting rules matter for a two-column file. */
function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }

  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ''));
}

const YES = new Set(['yes', 'y', 'true', '1', 'x', 'aid', 'financial aid']);
const NAME_HEADERS = ['name', 'full name', 'brother', 'member'];
const AID_HEADERS = ['financial aid', 'financial_aid', 'aid', 'fa', 'on aid'];

const clean = (h: string) => h.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export interface RosterCsvRow {
  name: string;
  financialAid: boolean;
}

export interface RosterCsvResult {
  rows: RosterCsvRow[];
  /** Lines that had no usable name, with the file line number. */
  skipped: { line: number; reason: string }[];
  /** True when a header row was found; a bare list of names is also accepted. */
  hadHeader: boolean;
}

export function readRosterCsv(text: string): RosterCsvResult {
  const table = parseCsv(text);
  if (!table.length) throw new Error('That file is empty.');

  const header = table[0].map(clean);
  const nameIdx = header.findIndex((h) => NAME_HEADERS.includes(h));
  const aidIdx = header.findIndex((h) => AID_HEADERS.includes(h));
  const hadHeader = nameIdx >= 0;

  // Without a header the file is treated as one name per line — the shape you
  // get from copying a single spreadsheet column.
  const nameCol = hadHeader ? nameIdx : 0;
  const body = hadHeader ? table.slice(1) : table;

  const rows: RosterCsvRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  const seen = new Set<string>();

  body.forEach((r, i) => {
    const line = (hadHeader ? 2 : 1) + i;
    const name = (r[nameCol] ?? '').trim();
    if (!name) { skipped.push({ line, reason: 'no name in that row' }); return; }
    if (!/[A-Za-z]/.test(name)) { skipped.push({ line, reason: `"${name}" isn't a name` }); return; }

    const key = normalizeName(name);
    if (seen.has(key)) { skipped.push({ line, reason: `"${name}" appears twice in the file` }); return; }
    seen.add(key);

    const aidCell = hadHeader && aidIdx >= 0 ? (r[aidIdx] ?? '').trim().toLowerCase() : '';
    rows.push({ name, financialAid: YES.has(aidCell) });
  });

  if (!rows.length) throw new Error('No usable names in that file.');
  return { rows, skipped, hadHeader };
}

/* ─────────────────────────── what would change ─────────────────────────── */

export interface RosterMatch {
  row: RosterCsvRow;
  member: MemberRow;
  /** 1 when the names are identical; lower when they were matched by similarity. */
  score: number;
}

export interface RosterPlan {
  /** On the file and already on the roster — kept, with history intact. */
  kept: RosterMatch[];
  /** On the file, nobody on the roster matched — inserted. */
  added: RosterCsvRow[];
  /** On the roster, not on the file. Empty for a pledge-class import. */
  removed: MemberRow[];
  /** Aid flags that would change on brothers who are staying. */
  aidChanges: { member: MemberRow; financialAid: boolean }[];
}

// Deliberately loose: an exec asked for aggressive matching rather than
// confirming each pair, so "Robert Chen" lands on "Bobby Chen" instead of
// arriving as a second brother and stranding the first one's payments and
// learned sender names. The cost is that two genuinely different brothers with
// close names can be merged, which is why the summary screen exists.
const MATCH_FLOOR = 0.75;

export function buildRosterPlan(
  csv: RosterCsvRow[], members: MemberRow[], mode: 'replace' | 'pledges',
): RosterPlan {
  const kept: RosterMatch[] = [];
  const added: RosterCsvRow[] = [];
  const aidChanges: { member: MemberRow; financialAid: boolean }[] = [];
  const claimed = new Set<string>();

  csv.forEach((row) => {
    const exact = members.find(
      (m) => !claimed.has(m.id) && normalizeName(m.name) === normalizeName(row.name),
    );

    let hit = exact;
    let score = 1;
    if (!hit) {
      const ranked = members
        .filter((m) => !claimed.has(m.id))
        .map((m) => ({ m, s: scoreName(row.name, m.name).score }))
        .sort((a, b) => b.s - a.s)[0];
      if (ranked && ranked.s >= MATCH_FLOOR) { hit = ranked.m; score = ranked.s; }
    }

    if (hit) {
      claimed.add(hit.id);
      kept.push({ row, member: hit, score });
      if (hit.financialAid !== row.financialAid) {
        aidChanges.push({ member: hit, financialAid: row.financialAid });
      }
    } else {
      added.push(row);
    }
  });

  // Only a replace removes anyone. A pledge-class import is purely additive —
  // it is a handful of new names, not a statement about who else exists.
  const removed = mode === 'replace'
    ? members.filter((m) => !claimed.has(m.id))
    : [];

  return { kept, added, removed, aidChanges };
}
