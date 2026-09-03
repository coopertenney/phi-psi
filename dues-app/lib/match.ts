// The matcher. A bank credit arrives with a sender name and an amount and
// nothing else — Zelle memos never reach bank transaction data, so there is no
// third signal to lean on (see CLAUDE.md). Everything here turns those two
// facts into ranked guesses plus a sentence explaining the guess, which the UI
// shows verbatim: an exec must be able to answer "why does the app think Bobby
// paid?" without reading code.

import type {
  BankTxn, Candidate, MatchTier, MemberBalance, MemberRow, NameAlias, QueueItem,
} from './types';
import { formatCents } from './money';

// A brother nobody has charged yet: owes nothing, on no term.
const NO_BALANCE: MemberBalance = {
  totalCents: 0, oldestCents: 0, oldestTermLabel: null, settlingAmounts: [], openTermCount: 0,
};

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

/* ─────────────────────────── string similarity ─────────────────────────── */

// Jaro-Winkler, not Levenshtein, for names. Two properties matter here: it
// weights a shared prefix, which is exactly how bank truncation and typos in
// surnames behave ("DARBELOF" vs "DARBELOFF"), and it tolerates transposed
// characters ("SHCMIDT") without the edit-distance penalty that a short name
// can't afford.
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aFlags = new Array(a.length).fill(false);
  const bFlags = new Array(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bFlags[j] || a[i] !== b[j]) continue;
      aFlags[i] = true;
      bFlags[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aFlags[i]) continue;
    while (!bFlags[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;

  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

// A bank descriptor is a fixed-width field, so long surnames arrive cut off
// ("CHRISTOPHER DARBELO"). A prefix of four or more characters is treated as a
// truncation rather than a different name.
function isTruncationOf(short: string, long: string): boolean {
  return short.length >= 4 && short.length < long.length && long.startsWith(short);
}

/* ─────────────────────────── phonetics ─────────────────────────── */

// A trimmed Metaphone: enough to make names that sound alike collide, without
// the full algorithm's table of exceptions. This is what catches a surname
// heard over the phone and typed into a bank app — SHAUGHNESSY/SHAUNESSY,
// KATZ/CATS, SMYTHE/SMITH — which plain edit distance scores as different words.
export function phonetic(input: string): string {
  let s = input.toUpperCase().replace(/[^A-Z]/g, '');
  if (!s) return '';

  // Silent leading pairs.
  s = s.replace(/^(KN|GN|PN|AE|WR)/, (m) => m[1]);
  s = s.replace(/^X/, 'S');
  s = s.replace(/^WH/, 'W');

  // Consonant rules run FIRST, while the vowels they key off are still there.
  // Stripping vowels up front (the original order) made every `C([IEY])`,
  // `G([IEY])` and `DG([EIY])` branch unreachable, so every C collapsed to K.
  s = s
    .replace(/X/g, 'KS')          // literal X, before X becomes the "sh" code
    .replace(/MB$/, 'M')
    .replace(/TCH/g, 'CH')
    .replace(/SCH/g, 'SK')
    .replace(/[SC]H/g, 'X')       // X is the "sh" sound from here on, never re-expanded
    .replace(/TH/g, 'T')          // SMITH and SMYTHE are one name
    .replace(/C([IEY])/g, 'S$1')
    .replace(/CK/g, 'K')
    .replace(/C/g, 'K')
    .replace(/DG([EIY])/g, 'J$1')
    .replace(/D/g, 'T')
    // GH after a vowel is silent — SHAUGHNESSY/SHAUNESSY only collide once this
    // is right, and that pair is the whole reason phonetics are here.
    .replace(/([AEIOU])GH/g, '$1')
    .replace(/GH/g, 'K')
    .replace(/G([IEY])/g, 'J$1')
    .replace(/G/g, 'K')
    .replace(/PH/g, 'F')
    .replace(/Q/g, 'K')
    .replace(/V/g, 'F')
    .replace(/Z/g, 'S');

  // An H after a vowel is silent (CAHILLY sounds like "KAILLY").
  s = s.replace(/([AEIOU])H/g, '$1');

  // W, Y and H carry sound only before a vowel (WANG, YEUNG, HUANG are three
  // different names); elsewhere they're silent. Dropping them unconditionally
  // collapsed all three onto one code.
  s = s.replace(/[WYH](?![AEIOU])/g, '');

  // Vowels last, and only the first one survives — it's the one a listener
  // reliably hears.
  s = s.replace(/[AEIOU]/g, (m, offset) => (offset === 0 ? 'A' : ''));

  return s.replace(/(.)\1+/g, '$1');   // collapse doubles
}

/* ─────────────────────────── the roster index ─────────────────────────── */

// Built once per ranking pass. Two things live here that a per-member scorer
// can't know on its own:
//
//   - **How rare a name is on this roster.** "DARBELOFF" identifies one brother;
//     "CHEN" might identify three. A surname match is worth far more when it's
//     unique, and the matcher should say so rather than treating both the same.
//   - **What the aliases have taught about families.** Once "LINDA MARSHALL" is
//     confirmed as Kevin's mother, a later credit from "ROBERT MARSHALL" is a
//     second parent, not a stranger — that inference needs the alias table, not
//     the roster name.
export interface RosterIndex {
  members: MemberRow[];
  /** Number of members sharing each surname phonetic code. */
  surnameCount: Map<string, number>;
  /** Number of members sharing each given-name phonetic code. */
  givenCount: Map<string, number>;
  /** Every given-name token anywhere on the roster, for spotting an outsider. */
  rosterGivenNames: Set<string>;
  /** memberId → surname codes seen on confirmed aliases for that member. */
  aliasSurnames: Map<string, Set<string>>;
}

// Particles carry no identifying information on their own: "De Silva" is
// indexed under SILVA, never under DE, or every short surname would collide
// with it phonetically.
const PARTICLES = new Set([
  'DE', 'DEL', 'DELA', 'DA', 'DI', 'DU', 'LA', 'LE', 'LO', 'VAN', 'VON', 'DER',
  'DEN', 'DOS', 'BIN', 'IBN', 'AL', 'EL', 'ST', 'SAN', 'SANTA',
]);

const surnameOf = (tokens: string[]) => tokens[tokens.length - 1] ?? '';
const givenOf = (tokens: string[]) => tokens[0] ?? '';

// Hyphenated and double-barrelled surnames arrive both ways ("GARCIA-LOPEZ",
// "GARCIA LOPEZ"), so each part is indexed as a surname in its own right.
function surnameVariants(name: string): string[] {
  const tokens = nameTokens(name);
  const last = surnameOf(tokens);
  const parts = normalizeName(name).split(' ').filter(Boolean);
  const hyphenParts = name.split(/[-–]/).map((p) => nameTokens(p).pop() ?? '').filter(Boolean);
  return Array.from(new Set([last, ...hyphenParts, ...(parts.length > 2 ? [parts[parts.length - 2]] : [])]))
    .filter((v) => v && !PARTICLES.has(v));
}

export function buildIndex(members: MemberRow[], aliases: NameAlias[]): RosterIndex {
  const surnameCount = new Map<string, number>();
  const givenCount = new Map<string, number>();
  const rosterGivenNames = new Set<string>();

  members.forEach((m) => {
    const tokens = nameTokens(m.name);
    surnameVariants(m.name).forEach((v) => {
      const code = phonetic(v);
      if (code) surnameCount.set(code, (surnameCount.get(code) ?? 0) + 1);
    });
    const given = givenOf(tokens);
    if (given) {
      rosterGivenNames.add(given);
      rosterGivenNames.add(canonical(given));
      const code = phonetic(canonical(given));
      if (code) givenCount.set(code, (givenCount.get(code) ?? 0) + 1);
    }
  });

  const aliasSurnames = new Map<string, Set<string>>();
  aliases.forEach((a) => {
    const code = phonetic(surnameOf(nameTokens(a.bankName)));
    if (!code) return;
    const set = aliasSurnames.get(a.memberId) ?? new Set<string>();
    set.add(code);
    aliasSurnames.set(a.memberId, set);
  });

  return { members, surnameCount, givenCount, rosterGivenNames, aliasSurnames };
}

/* ─────────────────────────── name scoring ─────────────────────────── */

export interface NameEvidence {
  score: number;
  /** Short phrase for the reason string, e.g. "surname matches, given name doesn't". */
  note: string;
  /** Only an initial stood in for the given name — likely to tie with someone else. */
  initialOnly: boolean;
  /** The sender's given name belongs to nobody on the roster: a parent or partner. */
  likelyRelative: boolean;
  /** Nothing else on the roster shares this surname sound. */
  uniqueSurname: boolean;
}

type Hit = { strength: number; how: string } | null;

// How well one sender token stands in for one roster token.
function tokenHit(sender: string, target: string): Hit {
  if (!sender || !target) return null;
  if (sender === target) return { strength: 1, how: 'matches' };
  if (isTruncationOf(sender, target) || isTruncationOf(target, sender)) {
    return { strength: 0.93, how: 'is the same name cut short by the bank' };
  }
  const jw = jaroWinkler(sender, target);
  if (jw >= 0.93) return { strength: 0.9, how: 'is one character off' };
  // Phonetics only on names long enough to have a distinctive sound, and only
  // when the spellings are at least in the same neighborhood. Short codes
  // collide indiscriminately — "TIAO" and the "DE" of "De Silva" both reduce to
  // a single consonant, which is not a resemblance.
  const sc = phonetic(sender);
  const tc = phonetic(target);
  if (
    sc && sc === tc && sc.length >= 3
    && sender.length >= 4 && target.length >= 4
    && jw >= 0.6
  ) {
    return { strength: 0.88, how: 'is spelled differently but sounds the same' };
  }
  if (jw >= 0.87) return { strength: 0.8, how: 'is close' };
  return null;
}

// The rarer a name is on this roster, the more a match on it is worth. A shared
// surname can't carry a confident match on its own — that's the two-brothers
// case the queue exists for.
function rareness(count: number): number {
  if (count <= 1) return 1;
  if (count === 2) return 0.72;
  return 0.55;
}

/**
 * How strongly a bank sender string looks like one roster name.
 *
 * Deliberately asymmetric. The surname carries the anchor because it's the
 * stable half — legal names, nicknames, and parents all diverge on the given
 * name and almost never on the surname. The given name then decides how much of
 * that anchor to trust, and roster rarity scales the whole thing.
 */
export function scoreName(sender: string, memberName: string, index?: RosterIndex): NameEvidence {
  const s = nameTokens(sender);
  const m = nameTokens(memberName);
  const base = {
    initialOnly: false, likelyRelative: false, uniqueSurname: false,
  };
  if (!s.length || !m.length) return { score: 0, note: 'no name to match on', ...base };

  if (s.join(' ') === m.join(' ')) {
    return { score: 1, note: 'name matches the roster exactly', ...base };
  }

  const memberGiven = givenOf(m);
  const memberSurnames = surnameVariants(memberName);
  const surnameCode = phonetic(surnameOf(m));
  const shareCount = index?.surnameCount.get(surnameCode) ?? 1;
  const uniqueSurname = shareCount <= 1;
  const rarity = rareness(shareCount);

  // Surname anchor: any sender token against any of the member's surname parts.
  // Order varies by institution ("SMITH ROBERT" and "ROBERT SMITH" are one
  // person), so position is not assumed.
  let surnameIdx = -1;
  let surnameHit: Hit = null;
  s.forEach((token, i) => {
    memberSurnames.forEach((variant) => {
      const hit = tokenHit(token, variant);
      if (hit && (!surnameHit || hit.strength > surnameHit.strength)) {
        surnameHit = hit;
        surnameIdx = i;
      }
    });
  });

  if (!surnameHit) {
    // No surname anchor at all. A whole-string similarity is the only thing
    // left, capped well below any confident tier so it can never stand alone.
    const whole = jaroWinkler(s.join(''), m.join(''));
    // Reversed-order full name ("SMITH ROBERT J") already passes the loop above;
    // this branch is genuinely "different person".
    return {
      score: Math.min(0.34, whole * 0.4),
      note: 'no surname on the roster matches this sender',
      ...base,
    };
  }

  const anchor = (surnameHit as { strength: number; how: string });
  const surnameNote = anchor.strength === 1
    ? 'surname matches'
    : `surname ${anchor.how}`;
  const others = s.filter((_, i) => i !== surnameIdx);

  // Surname and nothing else: "SMITH" alone, or a business-style descriptor.
  if (!others.length) {
    return {
      score: 0.55 * anchor.strength + (uniqueSurname ? 0.18 : 0),
      note: `${surnameNote}, but the sender gave no first name`,
      ...base,
      uniqueSurname,
    };
  }

  // Best given-name evidence across every non-surname token, so a middle name
  // or a second given name still counts.
  let given: { strength: number; note: string; initialOnly: boolean } | null = null;
  const consider = (cand: { strength: number; note: string; initialOnly: boolean }) => {
    if (!given || cand.strength > given.strength) given = cand;
  };

  others.forEach((token) => {
    const direct = tokenHit(token, memberGiven);
    if (direct) {
      consider({
        strength: direct.strength,
        note: direct.strength === 1
          ? 'and the first name matches too'
          : `and the first name ${direct.how}`,
        initialOnly: false,
      });
    }
    // Nickname divergence is systematic, not random — "Bobby" is always Robert —
    // so a lookup beats any string-distance trick here.
    if (canonical(token) === canonical(memberGiven) && token !== memberGiven) {
      consider({
        strength: 0.94,
        note: `and "${token}" and "${memberGiven}" are the same name`,
        initialOnly: false,
      });
    }
    if (token.length === 1 && token === memberGiven[0]) {
      consider({
        strength: 0.7,
        note: 'but only an initial stands in for the first name',
        initialOnly: true,
      });
    }
  });

  if (given) {
    const g = given as { strength: number; note: string; initialOnly: boolean };
    // A shared surname drags a confident name match down toward the tie the
    // queue has to surface; a unique one leaves it alone.
    const combined = (0.42 * anchor.strength + 0.58 * g.strength);
    const score = g.initialOnly ? combined * (0.72 + 0.28 * rarity) : combined * (0.86 + 0.14 * rarity);
    return {
      score: Math.min(0.999, score),
      note: `${surnameNote}, ${g.note}`,
      initialOnly: g.initialOnly,
      likelyRelative: false,
      uniqueSurname,
    };
  }

  // Surname anchored, given name belongs to nobody on the roster: the parent
  // case, and the single biggest source of manual work. Confidence here comes
  // from the surname being unique — one Marshall on the roster and a credit
  // from a different Marshall is close to decisive; three Chens and it isn't.
  const senderGiven = others.find((t) => t.length > 1) ?? others[0];
  const outsider = index ? !index.rosterGivenNames.has(canonical(senderGiven)) : true;
  const relativeScore = outsider
    ? (uniqueSurname ? 0.86 : shareCount === 2 ? 0.66 : 0.52) * anchor.strength
    : 0.5 * anchor.strength;

  return {
    score: relativeScore,
    note: outsider
      ? `${surnameNote}, but "${senderGiven}" isn't anyone on the roster — ${uniqueSurname
        ? 'and only one brother has that surname, so this reads as family paying for him'
        : 'this reads as family, and more than one brother shares that surname'}`
      : `${surnameNote}, but the first name belongs to a different brother`,
    initialOnly: false,
    likelyRelative: outsider,
    uniqueSurname,
  };
}

/* ─────────────────────────── ranking a credit ─────────────────────────── */

export interface MatchInput {
  txn: BankTxn;
  members: MemberRow[];
  aliases: NameAlias[];
  /**
   * memberId → what he owes, term by term (lib/ledger.ts `balancesByMember`).
   *
   * This used to be one number per brother, and one number stopped being true
   * the day two terms could be open at once. "Outstanding" is now ambiguous on
   * purpose: `totalCents` is what would square him with the chapter, and
   * `settlingAmounts` are the running totals of his open terms oldest-first —
   * the only amounts that settle a whole number of terms, and the ones a brother
   * paying up actually sends. The amount signal reads `settlingAmounts`, so a
   * payment matching ANY of his open terms (not just the total) still reads as
   * confident, while an amount that would leave a term part-paid does not.
   */
  balances: Record<string, MemberBalance>;
  /** The CURRENT term's dues charge, if an exec has set one — used for the
   *  "this is the full term charge" note the exec reads. */
  duesCents: number | null;
  /**
   * Every distinct per-brother term charge on the books, for split detection.
   * Fall is $537 and Spring is $300, so "exactly 2× the dues, probably two
   * brothers" has to be checked against all of them: a doubled Fall payment
   * arriving during Spring is invisible if only the current term is considered.
   * Defaults to the current term's charge alone.
   */
  duesOptions?: number[];
  /** Prebuilt roster index; built on the fly when a caller doesn't have one. */
  index?: RosterIndex;
}

const CONSIDER = 0.45;   // below this, a candidate isn't worth showing
const TIE_GAP = 0.04;    // two candidates this close are indistinguishable

// "JOHN SMITH AND MARY JONES", "R SMITH & K SMITH" — one credit, two senders.
// Split so both get ranked instead of the whole string scoring as nobody.
function splitSenders(sender: string): string[] {
  const parts = sender
    .split(/\s+(?:AND|&|\+)\s+/i)
    .map((p) => p.trim())
    .filter((p) => nameTokens(p).length > 0);
  return parts.length > 1 ? parts : [sender];
}

export function rankCredit(input: MatchInput): QueueItem {
  const { txn, members, aliases, balances, duesCents } = input;
  const balanceOf = (memberId: string) => balances[memberId] ?? NO_BALANCE;
  const index = input.index ?? buildIndex(members, aliases);
  const parsed = parseDescriptor(txn.rawDescription);
  const amount = txn.amountCents;
  const isReturn = amount < 0 || parsed.isReturn;
  const senders = splitSenders(parsed.senderName);

  const aliasHitFor = (sender: string) => {
    const key = normalizeName(sender);
    return key ? aliases.find((a) => normalizeName(a.bankName) === key) : undefined;
  };
  const exactAliases = senders.map(aliasHitFor);

  const scored = members.map((m) => {
    let best: NameEvidence = { score: 0, note: 'no name to match on', initialOnly: false, likelyRelative: false, uniqueSurname: false };
    let viaAlias = false;

    senders.forEach((sender, si) => {
      // A confirmed alias beats anything the scorer can infer — that's the whole
      // point of learning it.
      if (exactAliases[si]?.memberId === m.id) {
        best = { score: 1, note: 'this exact sender name was confirmed before', initialOnly: false, likelyRelative: false, uniqueSurname: true };
        viaAlias = true;
        return;
      }
      // The roster name and every learned variant of it, whichever fits best.
      const options = [m.name, ...m.aka];
      options.forEach((option) => {
        const ev = scoreName(sender, option, index);
        if (ev.score > best.score) best = ev;
      });

      // Family inference: this sender's surname was already confirmed for this
      // brother once, so a second relative paying isn't a stranger. Only fires
      // when the scorer already sees a family-shaped match, never on its own.
      const senderSurnameCode = phonetic(nameTokens(sender).slice(-1)[0] ?? '');
      if (
        best.likelyRelative && senderSurnameCode
        && index.aliasSurnames.get(m.id)?.has(senderSurnameCode)
      ) {
        best = {
          ...best,
          // Capped below the 'clear' threshold on purpose: a confirmed family
          // surname makes a relative's payment *likely*, never certain — the
          // brother it's for is still an inference, and inferences get confirmed
          // by a human, not auto-applied.
          score: Math.min(0.93, best.score + 0.12),
          note: `${best.note}, and someone with that surname has been confirmed as paying for him before`,
        };
      }
    });

    return { member: m, evidence: best, viaAlias };
  });

  scored.sort((a, b) => b.evidence.score - a.evidence.score);
  const keep = scored.filter((s) => s.evidence.score >= CONSIDER).slice(0, 4);

  const candidates: Candidate[] = keep.map((s) => {
    const bal = balanceOf(s.member.id);
    return {
      memberId: s.member.id,
      memberName: s.member.name,
      score: s.evidence.score,
      viaAlias: s.viaAlias,
      outstandingCents: bal.totalCents,
      oldestTermCents: bal.oldestCents,
      oldestTermLabel: bal.oldestTermLabel,
      openTermCount: bal.openTermCount,
    };
  });

  let top = keep[0];
  const abs = Math.abs(amount);
  const closeToTop = keep.filter((k) => keep[0].evidence.score - k.evidence.score <= TIE_GAP);
  let tied = closeToTop.length > 1;
  let brokenByAmount = false;

  // Amount as a tiebreaker. When the name genuinely can't separate two brothers
  // but only one of them owes exactly this much, that's a real signal and using
  // it removes a queue item a human would resolve the same way. If both fit the
  // amount, it stays tied — the app refuses to guess.
  //
  // "Owes exactly this much" now means "squares a whole run of his open terms",
  // not "equals one number": with Fall and Winter both open, $1074 is exactly
  // what he owes just as much as $537 is exactly what his oldest term takes.
  if (tied) {
    const fits = closeToTop.filter(
      (k) => abs > 0 && balanceOf(k.member.id).settlingAmounts.includes(abs),
    );
    if (fits.length === 1) {
      top = fits[0];
      tied = false;
      brokenByAmount = true;
      const winner = candidates.find((c) => c.memberId === top.member.id);
      if (winner) {
        candidates.splice(candidates.indexOf(winner), 1);
        candidates.unshift(winner);
      }
    }
  }

  // An explicit SR is never the college-age brother — it's his father, and which
  // brother a relative is paying for is a human call. JR is left alone: a legal
  // name with a suffix is how the brother's own name arrives at the bank.
  const sendersSenior = /\bSR\b|\bSENIOR\b/.test(normalizeName(parsed.senderName));

  /* ---- what the amount says ---- */
  const bal = top ? balanceOf(top.member.id) : NO_BALANCE;
  const outstanding = bal.totalCents;
  // Squares a whole run of his open terms, oldest first. This is the multi-term
  // replacement for "amount === outstanding": a brother owing Fall $537 and
  // Winter $537 who sends $537 has paid exactly one term, and one who sends
  // $1074 has paid exactly two. Both are unambiguous; neither equals a single
  // "outstanding" number.
  const settlesWholeTerms = abs > 0 && bal.settlingAmounts.includes(abs);
  const exactBalance = Boolean(top) && settlesWholeTerms;
  const exactDues = duesCents !== null && abs === duesCents;

  // Split detection, checked against every term charge on the books rather than
  // only the current term's, because Fall costs $537 and Spring costs $300 — a
  // doubled Fall payment arriving in Spring is invisible to a current-term-only
  // test. `splitShare` is the charge it divided by, so the UI offers the right
  // halves instead of assuming the current term's price.
  const options = (input.duesOptions ?? (duesCents !== null ? [duesCents] : []))
    .filter((d) => d > 0);
  const splitShare = options.find((d) => abs % d === 0 && abs / d >= 2) ?? null;
  const isMultiple = splitShare !== null;

  const partial = Boolean(top) && !isReturn && outstanding > 0 && abs < outstanding;
  const overpay = Boolean(top) && !isReturn && outstanding > 0 && abs > outstanding && !isMultiple;

  // Do we know WHICH TERM this money settles? The waterfall in lib/ledger.ts is
  // oldest-unpaid-first and has no discretion in exactly three cases, and those
  // three are the only ones where nothing can be credited to the wrong quarter:
  //
  //   - he owes on one term or none, so there is nowhere else it could land;
  //   - it squares a whole run of terms exactly (settlesWholeTerms);
  //   - it covers everything he owes, so every open term is settled and the
  //     remainder is reported as overpayment rather than credited anywhere.
  //
  // Everything else leaves some term part-paid, and part-paid is where the wrong
  // quarter gets money: a brother owing Fall $537 and Spring $300 who sends $300
  // almost certainly meant Spring, while oldest-first would put it on Fall. That
  // is a judgment, so it queues. Deliberately independent of `nameCertain`: that
  // answers "whose money is this", this answers "where does it go", and
  // lib/autoapply.ts needs both before it moves anything.
  const termCertain = Boolean(top) && !isReturn && abs > 0 && (
    bal.openTermCount <= 1 || settlesWholeTerms || abs >= outstanding
  );

  // Is the NAME beyond doubt? Separate from the tier on purpose: a partial
  // payment from an unmistakable sender is certain about who and unusual about
  // how much, and auto-apply needs those answered independently.
  const runnerUp = keep[1]?.evidence.score ?? 0;
  const nameCertain = Boolean(top)
    && !tied
    && !brokenByAmount              // the balance broke the tie, not the name
    && !sendersSenior               // the father, not the brother
    && !top.evidence.likelyRelative // a parent, and which brother is a guess
    && top.evidence.score >= 0.95
    && top.evidence.score - runnerUp > TIE_GAP * 2;

  // How many of his open terms this amount squares, for the note below.
  const termsCovered = settlesWholeTerms ? bal.settlingAmounts.indexOf(abs) + 1 : 0;
  const oldestLabel = bal.oldestTermLabel ?? 'his oldest unpaid term';

  let amountNote: string;
  if (isReturn) amountNote = `${formatCents(abs)} came back`;
  else if (isMultiple && splitShare) amountNote = `${formatCents(abs)} is exactly ${abs / splitShare}× the ${formatCents(splitShare)} term charge — likely covering more than one brother`;
  else if (brokenByAmount) amountNote = `${formatCents(abs)} is exactly what ${top.member.name} still owes and not what the others owe, which settles it`;
  else if (termsCovered > 1) amountNote = `${formatCents(abs)} is exactly what he owes for ${termsCovered} terms, starting with ${oldestLabel}`;
  else if (exactBalance && bal.openTermCount > 1) amountNote = `${formatCents(abs)} is exactly what he owes for ${oldestLabel}, his oldest unpaid term — the rest of his balance stays open`;
  else if (exactBalance) amountNote = `${formatCents(abs)} is exactly what they still owe`;
  else if (exactDues) amountNote = `${formatCents(abs)} is the full term charge`;
  // The oldest-first rule is stated out loud whenever the money will not land
  // cleanly: an exec reading "apply it as a partial" deserves to know which
  // quarter it partly pays.
  else if (partial && bal.openTermCount > 1) amountNote = `${formatCents(abs)} is short of the ${formatCents(outstanding)} he owes across ${bal.openTermCount} terms — it would go against ${oldestLabel} first`;
  else if (partial) amountNote = `${formatCents(abs)} is short of the ${formatCents(outstanding)} still owed — apply it as a partial payment`;
  else if (overpay) amountNote = `${formatCents(abs)} is more than the ${formatCents(outstanding)} still owed`;
  else if (!top) amountNote = `${formatCents(abs)} matches no outstanding charge`;
  else amountNote = `${formatCents(abs)} doesn't line up with a charge`;

  /* ---- tier ---- */
  // 'clear' is the only tier auto-apply will touch (lib/autoapply.ts), so it
  // requires both halves of the evidence: a name that isn't in question, and an
  // amount that settles the balance exactly.
  let tier: MatchTier;
  if (isReturn) tier = 'return';
  else if (!top) tier = 'unclear';
  else if (tied) tier = 'unclear';
  // A family payer is never 'clear', however unique the surname: the sender is
  // not the brother, and which brother it's for is exactly the judgment an exec
  // is here to make once — after which the alias makes it automatic.
  else if (top.evidence.likelyRelative) tier = 'check';
  else if (sendersSenior) tier = 'check';
  // `brokenByAmount` means the name alone could NOT separate two brothers and the
  // balance cast the deciding vote. That is good enough to show a ranked guess,
  // never good enough to move money unattended — both CLAUDE.md and the UI
  // promise a tie always waits for a human.
  else if (brokenByAmount) tier = 'check';
  // `termCertain` joined this condition when terms started overlapping. Without
  // it, `exactDues` alone could reach 'clear' for a brother whose oldest term is
  // part-paid — the amount equals the term charge, but pouring it oldest-first
  // settles a stub of Fall and drops the rest on Winter. Confident about the
  // name and the number, wrong about the quarter.
  else if (top.evidence.score >= 0.95 && (exactBalance || exactDues) && !isMultiple && termCertain) tier = 'clear';
  else if (top.evidence.score >= 0.66) tier = 'check';
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
    const names = closeToTop.map((k) => k.member.name);
    reason = `${names.join(' and ')} fit this sender equally well and the amount works for either. Refusing to guess — pick one.`;
  } else if (!top) {
    reason = `Nobody on the roster matches "${parsed.senderName}". ${amountNote}.`;
  } else if (sendersSenior && top) {
    reason = `${capitalize(top.evidence.note)}, but the sender is a senior — this is almost certainly ${top.member.name}'s father paying for him. ${capitalize(amountNote)}.`;
  } else if (senders.length > 1) {
    reason = `The descriptor names ${senders.length} senders. ${capitalize(top.evidence.note)}. ${capitalize(amountNote)}.`;
  } else {
    reason = `${capitalize(top.evidence.note)}. ${capitalize(amountNote)}.`;
  }

  return {
    txn, tier, candidates, reason, partial, split: isMultiple, tied,
    nameCertain, termCertain, splitShareCents: splitShare, overpay,
    noSender: !parsed.senderName,
    notAPerson: !parsed.recognized,
  };
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
