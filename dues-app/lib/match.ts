// The matcher. A bank credit arrives with a sender name and an amount and
// nothing else — Zelle memos never reach bank transaction data, so there is no
// third signal to lean on (see CLAUDE.md). Everything here turns those two
// facts into ranked guesses plus a sentence explaining the guess, which the UI
// shows verbatim: an exec must be able to answer "why does the app think Bobby
// paid?" without reading code.

import type { BankTxn, Candidate, MatchTier, MemberRow, NameAlias, QueueItem } from './types';
import { formatCents } from './money';

/* ─────────────────────────── name normalization ─────────────────────────── */

const SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V']);

// Institution-specific noise wrapped around the sender name. Descriptors vary
// by bank, so this list grows as real examples arrive; Stanford FCU's exact
// format is still unconfirmed (CLAUDE.md, "Still open").
const CREDIT_PREFIXES = [
  /^ZELLE\s+(INSTANT\s+)?(PMT|PAYMENT|TRANSFER|CREDIT)\s+FROM\s+/i,
  /^ZELLE\s+FROM\s+/i,
  /^ZELLE\s+/i,
  /^(INCOMING|EXTERNAL)\s+(TRANSFER|DEPOSIT)\s+FROM\s+/i,
  /^(ACH|ONLINE|MOBILE)\s+(CREDIT|DEPOSIT|TRANSFER)\s+FROM\s+/i,
  /^DEPOSIT\s+FROM\s+/i,
];

const RETURN_PREFIXES = [
  /^ZELLE\s+RETURN\s*[—–-]?\s*/i,
  /^(RETURNED|REVERSAL|REVERSED)\s+(ITEM|PAYMENT|CREDIT)?\s*[—–-]?\s*/i,
];

// Trailing junk banks append: confirmation ids, reference numbers, dates. The
// bare-token pattern requires at least one digit — without that it happily ate
// long surnames (DARBELOFF, WOHLBERG) and left the matcher a first name only.
const TRAILING_NOISE = [
  /\s+(CONF|REF|ID|TRN|TRACE)\s*#?\s*[A-Z0-9]{4,}$/i,
  /\s+#?\b(?=[A-Z0-9]*\d)[A-Z0-9]{6,}\b$/,
  /\s+\d{4,}$/,
];

export interface ParsedDescriptor {
  senderName: string;   // best guess at the human name, "" when there isn't one
  isReturn: boolean;    // the descriptor says this reverses an earlier credit
  recognized: boolean;  // a known credit shape, not e.g. a check deposit
}

export function parseDescriptor(raw: string): ParsedDescriptor {
  let s = raw.trim();
  let isReturn = false;
  let recognized = false;

  for (const re of RETURN_PREFIXES) {
    if (re.test(s)) { s = s.replace(re, ''); isReturn = true; recognized = true; break; }
  }
  if (!isReturn) {
    for (const re of CREDIT_PREFIXES) {
      if (re.test(s)) { s = s.replace(re, ''); recognized = true; break; }
    }
  }
  for (const re of TRAILING_NOISE) s = s.replace(re, '');

  // A descriptor with no letters left (a check number, a wire reference) has no
  // sender name to match on at all.
  const senderName = /[A-Za-z]/.test(s) ? s.trim() : '';
  return { senderName, isReturn, recognized };
}

export function normalizeName(input: string): string {
  return input
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip accents
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')                          // punctuation, digits out
    .replace(/\s+/g, ' ')
    .trim();
}

// Tokens with suffixes dropped. Middle names/initials are kept — they're
// evidence, just weak evidence.
export function nameTokens(input: string): string[] {
  return normalizeName(input).split(' ').filter((t) => t && !SUFFIXES.has(t));
}

// Nickname divergence is systematic, not random ("Bobby" is always Robert), so
// a lookup table beats any string-distance trick here. Formal name → nicknames.
const NICKNAMES: Record<string, string[]> = {
  ROBERT: ['BOB', 'BOBBY', 'ROB', 'ROBBIE'],
  WILLIAM: ['BILL', 'BILLY', 'WILL', 'WILLY', 'LIAM'],
  RICHARD: ['RICK', 'RICKY', 'DICK', 'RICH', 'RICHIE'],
  MICHAEL: ['MIKE', 'MIKEY', 'MICK'],
  JAMES: ['JIM', 'JIMMY', 'JAMIE'],
  JOHN: ['JACK', 'JOHNNY', 'JON'],
  JONATHAN: ['JON', 'JONNY', 'JOHNNY'],
  JOSEPH: ['JOE', 'JOEY'],
  CHARLES: ['CHARLIE', 'CHUCK', 'CHAZ'],
  THOMAS: ['TOM', 'TOMMY'],
  CHRISTOPHER: ['CHRIS', 'TOPHER'],
  DANIEL: ['DAN', 'DANNY'],
  MATTHEW: ['MATT', 'MATTY'],
  ANTHONY: ['TONY'],
  ANDREW: ['ANDY', 'DREW'],
  BENJAMIN: ['BEN', 'BENJI', 'BENNY'],
  SAMUEL: ['SAM', 'SAMMY'],
  ALEXANDER: ['ALEX', 'XANDER', 'AL'],
  NICHOLAS: ['NICK', 'NICKY'],
  EDWARD: ['ED', 'EDDIE', 'TED', 'NED'],
  STEPHEN: ['STEVE', 'STEVIE'],
  STEVEN: ['STEVE', 'STEVIE'],
  TIMOTHY: ['TIM', 'TIMMY'],
  GREGORY: ['GREG'],
  JEFFREY: ['JEFF'],
  KENNETH: ['KEN', 'KENNY'],
  RONALD: ['RON', 'RONNIE'],
  DAVID: ['DAVE', 'DAVEY'],
  PATRICK: ['PAT', 'PATTY'],
  ZACHARY: ['ZACH', 'ZAC', 'ZAK'],
  NATHANIEL: ['NATE', 'NAT'],
  NATHAN: ['NATE'],
  PETER: ['PETE'],
  VINCENT: ['VINNY', 'VINCE'],
  GABRIEL: ['GABE'],
  ELIJAH: ['ELI'],
  ISABELLA: ['BELLA'],       // parents pay too
  KATHERINE: ['KATE', 'KATIE', 'KATHY', 'CATHY'],
  MARGARET: ['MEG', 'MAGGIE', 'PEGGY'],
  ELIZABETH: ['LIZ', 'BETH', 'BETSY', 'LIZZIE'],
};

// nickname → formal, built once from the table above.
const TO_FORMAL: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [formal, nicks] of Object.entries(NICKNAMES)) {
    for (const n of nicks) out[n] = formal;
  }
  return out;
})();

function canonical(token: string): string {
  return TO_FORMAL[token] ?? token;
}

// The formal name a nickname stands for, or null if the token already is one.
// Only used to build the walkthrough's legal-name case (lib/sample.ts).
export function formalFor(token: string): string | null {
  return TO_FORMAL[token.toUpperCase()] ?? null;
}

function sameGivenName(a: string, b: string): boolean {
  return a === b || canonical(a) === canonical(b);
}

/* ─────────────────────────── string distance ─────────────────────────── */

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

// 1 = identical, 0 = nothing in common. Used for typos and truncation only —
// never as the sole reason to credit someone.
function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (!longest) return 0;
  return 1 - levenshtein(a, b) / longest;
}

/* ─────────────────────────── name scoring ─────────────────────────── */

export interface NameEvidence {
  score: number;
  /** Short phrase for the reason string, e.g. "surname matches, given name doesn't". */
  note: string;
  /** Only an initial stood in for the given name — likely to tie with someone else. */
  initialOnly: boolean;
}

// How strongly a bank sender string looks like a given roster name. Deliberately
// asymmetric: a matching surname carries most of the weight, because the given
// name is where legal names, nicknames, and parents diverge.
export function scoreName(sender: string, memberName: string): NameEvidence {
  const s = nameTokens(sender);
  const m = nameTokens(memberName);
  if (!s.length || !m.length) return { score: 0, note: 'no name to match on', initialOnly: false };

  if (s.join(' ') === m.join(' ')) {
    return { score: 1, note: 'name matches the roster exactly', initialOnly: false };
  }

  const memberSurname = m[m.length - 1];
  const memberGiven = m[0];

  // Surname anywhere in the sender string — order varies by institution
  // ("SMITH ROBERT" and "ROBERT SMITH" are the same person).
  let surnameIdx = s.findIndex((t) => t === memberSurname);
  let surnameFuzzy = false;
  if (surnameIdx < 0) {
    surnameIdx = s.findIndex((t) => t.length > 3 && similarity(t, memberSurname) >= 0.85);
    surnameFuzzy = surnameIdx >= 0;
  }

  if (surnameIdx < 0) {
    // No surname anchor. Fall back to whole-string similarity, capped low
    // enough that it can never reach a confident tier on its own.
    const whole = similarity(s.join(' '), m.join(' '));
    return {
      score: Math.min(0.35, whole),
      note: 'no surname on the roster matches this sender',
      initialOnly: false,
    };
  }

  const others = s.filter((_, i) => i !== surnameIdx);
  const surnameNote = surnameFuzzy ? 'surname is close' : 'surname matches';

  if (!others.length) {
    return { score: 0.6, note: `${surnameNote}, but the sender gave no first name`, initialOnly: false };
  }

  if (others.some((t) => t === memberGiven)) {
    return { score: 0.98, note: `${surnameNote} and so does the first name`, initialOnly: false };
  }
  if (others.some((t) => sameGivenName(t, memberGiven))) {
    const nick = others.find((t) => sameGivenName(t, memberGiven))!;
    return {
      score: 0.92,
      note: `${surnameNote}, and "${nick}" and "${memberGiven}" are the same name`,
      initialOnly: false,
    };
  }
  if (others.some((t) => t.length === 1 && t === memberGiven[0])) {
    return {
      score: 0.72,
      note: `${surnameNote}, but only an initial stands in for the first name`,
      initialOnly: true,
    };
  }
  if (others.some((t) => t.length > 3 && similarity(t, memberGiven) >= 0.8)) {
    return { score: 0.8, note: `${surnameNote}, first name is a near-miss`, initialOnly: false };
  }
  return {
    score: 0.5,
    note: `${surnameNote}, but the first name belongs to somebody else — likely a parent`,
    initialOnly: false,
  };
}

/* ─────────────────────────── ranking a credit ─────────────────────────── */

export interface MatchInput {
  txn: BankTxn;
  members: MemberRow[];
  aliases: NameAlias[];
  /** memberId → what they still owe this term, in cents. */
  outstandingByMember: Record<string, number>;
  /** The term's dues charge, if an exec has set one. */
  duesCents: number | null;
}

const CONSIDER = 0.5;   // below this, a candidate isn't worth showing
const TIE_GAP = 0.04;   // two candidates this close are indistinguishable

export function rankCredit(input: MatchInput): QueueItem {
  const { txn, members, aliases, outstandingByMember, duesCents } = input;
  const parsed = parseDescriptor(txn.rawDescription);
  const amount = txn.amountCents;
  const isReturn = amount < 0 || parsed.isReturn;

  const aliasKey = normalizeName(parsed.senderName);
  const aliasHit = aliasKey ? aliases.find((a) => normalizeName(a.bankName) === aliasKey) : undefined;

  const scored = members.map((m) => {
    const viaAlias = aliasHit?.memberId === m.id;
    const direct = scoreName(parsed.senderName, m.name);
    // A confirmed alias beats anything the name scorer can infer — that's the
    // whole point of learning it.
    const best = viaAlias ? { score: 1, note: 'this exact sender name was confirmed before', initialOnly: false } : direct;
    // Learned variants stored on the member get the same treatment.
    const akaBest = m.aka
      .map((a) => (normalizeName(a) === aliasKey
        ? { score: 1, note: 'this exact sender name was confirmed before', initialOnly: false }
        : scoreName(parsed.senderName, a)))
      .reduce<NameEvidence | null>((acc, ev) => (!acc || ev.score > acc.score ? ev : acc), null);
    const evidence = akaBest && akaBest.score > best.score ? akaBest : best;
    return { member: m, evidence, viaAlias };
  });

  scored.sort((a, b) => b.evidence.score - a.evidence.score);
  const keep = scored.filter((s) => s.evidence.score >= CONSIDER).slice(0, 4);

  const candidates: Candidate[] = keep.map((s) => ({
    memberId: s.member.id,
    memberName: s.member.name,
    score: s.evidence.score,
    viaAlias: s.viaAlias,
    outstandingCents: outstandingByMember[s.member.id] ?? 0,
  }));

  const top = keep[0];
  const tied = keep.length > 1 && keep[0].evidence.score - keep[1].evidence.score <= TIE_GAP;

  /* ---- what the amount says ---- */
  const abs = Math.abs(amount);
  const outstanding = top ? (outstandingByMember[top.member.id] ?? 0) : 0;
  const exactBalance = Boolean(top) && abs === outstanding && outstanding > 0;
  const exactDues = duesCents !== null && abs === duesCents;
  const isMultiple = duesCents !== null && duesCents > 0 && abs % duesCents === 0 && abs / duesCents >= 2;
  const partial = Boolean(top) && !isReturn && outstanding > 0 && abs < outstanding;
  const overpay = Boolean(top) && !isReturn && outstanding > 0 && abs > outstanding && !isMultiple;

  let amountNote: string;
  if (isReturn) amountNote = `${formatCents(abs)} came back`;
  else if (isMultiple && duesCents) amountNote = `${formatCents(abs)} is exactly ${abs / duesCents}× the ${formatCents(duesCents)} term charge — likely covering more than one brother`;
  else if (exactBalance) amountNote = `${formatCents(abs)} is exactly what they still owe`;
  else if (exactDues) amountNote = `${formatCents(abs)} is the full term charge`;
  else if (partial) amountNote = `${formatCents(abs)} is short of the ${formatCents(outstanding)} still owed — apply it as a partial payment`;
  else if (overpay) amountNote = `${formatCents(abs)} is more than the ${formatCents(outstanding)} still owed`;
  else if (!top) amountNote = `${formatCents(abs)} matches no outstanding charge`;
  else amountNote = `${formatCents(abs)} doesn't line up with a charge`;

  /* ---- tier ---- */
  let tier: MatchTier;
  if (isReturn) tier = 'return';
  else if (!top) tier = 'unclear';
  else if (tied) tier = 'unclear';
  else if (top.evidence.score >= 0.95 && (exactBalance || exactDues) && !isMultiple) tier = 'clear';
  else if (top.evidence.score >= 0.7) tier = 'check';
  else tier = 'unclear';

  /* ---- reason ---- */
  let reason: string;
  if (!parsed.senderName) {
    reason = `The descriptor carries no sender name, and ${formatCents(abs)} matches no outstanding charge. Probably not dues.`;
  } else if (!top && !parsed.recognized) {
    reason = `This isn't a transfer from a person — no sender name to match, and ${formatCents(abs)} matches no outstanding charge. Probably not dues.`;
  } else if (isReturn && top) {
    reason = `A credit already applied to ${top.member.name} came back. Reversing it puts them back on the unpaid list.`;
  } else if (isReturn) {
    reason = `This reverses an earlier credit, but no applied payment matches the sender. Find it by hand before reversing.`;
  } else if (tied) {
    const names = keep.filter((k) => keep[0].evidence.score - k.evidence.score <= TIE_GAP).map((k) => k.member.name);
    reason = `${names.join(' and ')} fit this sender equally well and the amount works for either. Refusing to guess — pick one.`;
  } else if (!top) {
    reason = `Nobody on the roster matches "${parsed.senderName}". ${amountNote}.`;
  } else {
    reason = `${capitalize(top.evidence.note)}. ${capitalize(amountNote)}.`;
  }

  return { txn, tier, candidates, reason, partial, split: isMultiple, tied };
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// The sender string to remember when an exec corrects a guess. Returns null
// when the bank name already equals the roster name — nothing to learn.
export function aliasToLearn(rawDescription: string, memberName: string): string | null {
  const { senderName } = parseDescriptor(rawDescription);
  if (!senderName) return null;
  if (normalizeName(senderName) === normalizeName(memberName)) return null;
  return senderName.trim();
}
