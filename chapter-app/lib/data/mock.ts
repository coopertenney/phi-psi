import type {
  MemberRow, ChapterStats, MemberFlag, MeetingRow, AttendanceRecord,
  EventRow, EventType, AnnouncementRow, PnmRow, PnmStage, PointItem, PointEntry,
  DriveItem,
} from '../types';
import { NOW, memberAttendance, attendancePctFrom, rsvpFor, seededUnit } from '../engagement';
import { memberPointTotal } from '../points';

// The prototype roster, shaped as the data-layer's output. Balances follow the
// seed: paid -> $0, partial -> $350, due -> $850 (charge $850 - payment).
type Seed = {
  name: string; email: string; phone: string; position: string | null;
  status: MemberRow['status']; classYear: number; committee: string;
  big: string | null;  // lineage: name of this member's big
  points: number; attendancePct: number; dues: MemberRow['duesState'];
};

const SEED: Seed[] = [
  { name: 'Marcus Chen',   email: 'mchen@stanford.edu',    phone: '(650) 555-0112', position: 'President',          status: 'active',   classYear: 2026, committee: 'Executive',        big: null,            points: 480, attendancePct: 100, dues: 'paid' },
  { name: 'Aisha Patel',   email: 'apatel@stanford.edu',   phone: '(650) 555-0128', position: 'Treasurer',          status: 'active',   classYear: 2027, committee: 'Finance',          big: null,            points: 462, attendancePct: 96,  dues: 'paid' },
  { name: 'Diego Ramirez', email: 'dramirez@stanford.edu', phone: '(650) 555-0143', position: 'Vice President',     status: 'active',   classYear: 2026, committee: 'Executive',        big: 'Marcus Chen',   points: 445, attendancePct: 94,  dues: 'paid' },
  { name: 'Jordan Avery',  email: 'javery@stanford.edu',   phone: '(650) 555-0159', position: 'Recruitment Chair',  status: 'active',   classYear: 2027, committee: 'Recruitment',      big: 'Aisha Patel',   points: 410, attendancePct: 88,  dues: 'partial' },
  { name: 'Tyler Brooks',  email: 'tbrooks@stanford.edu',  phone: '(650) 555-0164', position: 'Social Chair',       status: 'active',   classYear: 2027, committee: 'Social',           big: 'Marcus Chen',   points: 388, attendancePct: 90,  dues: 'due' },
  { name: 'Noah Williams', email: 'nwilliams@stanford.edu',phone: '(650) 555-0177', position: 'Philanthropy Chair', status: 'active',   classYear: 2028, committee: 'Service',          big: 'Tyler Brooks',  points: 372, attendancePct: 88,  dues: 'paid' },
  { name: 'Ethan Park',    email: 'epark@stanford.edu',    phone: '(650) 555-0182', position: 'Secretary',          status: 'active',   classYear: 2028, committee: 'Executive',        big: 'Aisha Patel',   points: 355, attendancePct: 84,  dues: 'partial' },
  { name: 'Liam Foster',   email: 'lfoster@stanford.edu',  phone: '(650) 555-0195', position: 'Risk Manager',       status: 'active',   classYear: 2026, committee: 'Standards',        big: null,            points: 340, attendancePct: 82,  dues: 'paid' },
  { name: 'Caleb Nguyen',  email: 'cnguyen@stanford.edu',  phone: '(650) 555-0201', position: null,                 status: 'active',   classYear: 2028, committee: 'Social',           big: 'Diego Ramirez', points: 295, attendancePct: 76,  dues: 'due' },
  { name: 'Owen Mitchell', email: 'omitchell@stanford.edu',phone: '(650) 555-0216', position: null,                 status: 'new',      classYear: 2029, committee: 'New Member Class', big: 'Jordan Avery',  points: 180, attendancePct: 94,  dues: 'partial' },
  { name: 'Sam Rivera',    email: 'srivera@stanford.edu',  phone: '(650) 555-0224', position: null,                 status: 'new',      classYear: 2029, committee: 'New Member Class', big: 'Ethan Park',    points: 150, attendancePct: 88,  dues: 'due' },
  { name: 'Henry Cole',    email: 'hcole@stanford.edu',    phone: '(650) 555-0238', position: null,                 status: 'inactive', classYear: 2027, committee: 'Unassigned',       big: 'Liam Foster',   points: 90,  attendancePct: 38,  dues: 'due' },
];

const balanceFor = (dues: MemberRow['duesState']) =>
  dues === 'paid' ? 0 : dues === 'partial' ? 35000 : 85000;

const roleLabel = (s: Seed) =>
  s.position ?? (s.status === 'new' ? 'New Member' : 'Brother');

// Invert the big→member relation so each member knows their littles.
const littlesByBig = SEED.reduce<Record<string, string[]>>((acc, s) => {
  if (s.big) (acc[s.big] ??= []).push(s.name);
  return acc;
}, {});

// Manually-set compliance flags (standards board), keyed by member name. These
// merge with the auto-derived ones (overdue dues, low attendance).
const MANUAL_FLAGS: Record<string, Omit<MemberFlag, 'id'>[]> = {
  'Caleb Nguyen': [{ label: 'Risk mgmt form unsigned', severity: 'warning', note: 'Required before next social' }],
  'Owen Mitchell': [{ label: 'New member education incomplete', severity: 'info', note: '2 modules remaining' }],
  'Henry Cole': [{ label: 'Inactive — needs re-engagement', severity: 'info' }],
};

// Flags derive from the member's *displayed* (computed) attendance %, not the
// seed target, so the dot/severity always matches what the drawer shows.
function flagsFor(s: Seed, i: number, pct: number): MemberFlag[] {
  const out: MemberFlag[] = [];
  const id = (k: string) => `mock-${i + 1}-${k}`;
  if (s.dues === 'due') out.push({ id: id('dues'), label: 'Dues overdue', severity: 'danger', note: 'Spring quarter balance unpaid' });
  if (pct < 50) out.push({ id: id('att'), label: 'Below attendance minimum', severity: 'danger' });
  else if (pct < 80) out.push({ id: id('att'), label: 'Attendance watch', severity: 'warning' });
  (MANUAL_FLAGS[s.name] ?? []).forEach((f, k) => out.push({ ...f, id: id('m' + k) }));
  return out;
}

/* ─────────────────────────── Meetings & attendance ───────────────────────────
   Raw attendance facts: 12 weekly chapter meetings leading up to NOW, and each
   member's present/excused/absent across them. attendancePct on the roster is
   *derived* from these (raw facts → derived numbers, per CLAUDE.md) rather than
   stored — wiring member_standings.attendance_pct to computed data per ROADMAP. */

const MEETING_COUNT = 12;

export const mockMeetings: MeetingRow[] = Array.from({ length: MEETING_COUNT }, (_, i) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - (MEETING_COUNT - i) * 7); // oldest first, weekly
  d.setHours(19, 0, 0, 0);
  return { id: `mtg-${i + 1}`, title: 'Chapter Meeting', date: d.toISOString() };
});

// memberAttendance is seeded with the member's intended figure so the derived
// percentage tracks the original roster numbers (thresholds 95/80/50 preserved).
export const mockAttendance: AttendanceRecord[] = SEED.map((s, i) => ({
  membershipId: `mock-${i + 1}`,
  states: memberAttendance(`mock-${i + 1}`, s.attendancePct, MEETING_COUNT),
}));

const attendanceByMember = new Map(mockAttendance.map((a) => [a.membershipId, a.states]));

/* ─────────────────────────── Points: catalog + log ───────────────────────────
   Item catalog ported verbatim from the chapter's Google-Sheet "POINTS (items)"
   tab (values only — none of the sheet's real people). The log is generated per
   member from an engagement score anchored to their roster standing, and each
   member's `points` is then *derived* from it via MAX(-5, Σ) — see lib/points.ts.
   This replaces the old seeded points number, the way the real tracker works. */

type ItemSeed = [label: string, points: number];
const REWARD_SEED: ItemSeed[] = [
  ['Being GP or VP (per quarter)', 30], ['Former president', 30],
  ['Be a senior who is bought into the org', 20], ['Being Part of Exec (per quarter) and completing deliverables', 20],
  ['Painting a (beautiful) Die Table', 15], ['Being Part of a Committee (per quarter) and complete deliverables', 10],
  ['Be a rush chair and complete deliverables', 8], ['Extra Sober Shift (above minimum)', 6],
  ["Volunteering to Pick Up Someone's Sober Shift", 5], ['Fronting a large purchase for the house', 5],
  ['Attend a Philanthropy Event', 4], ['DJing', 4], ['Party Setup Shift', 3], ['Narcan Training (one time only)', 3],
  ['Completing a (required) Sober Shift', 3], ['Party Cleanup Crew Shift', 3], ['Picked Up an Extra Hash Shift', 2],
  ['Bringing a (unique) PNM to the house', 2], ['Showing Up to Formal Chapter Wearing Formal Attire', 1],
  ['Completing a (required) Party Shift', 1],
];
const DISCRETIONARY_SEED: string[] = [
  'Other task approved in advance by GP or VP', 'Planning a Successful Event (e.g. CoPhi house, mixer)',
  'Big/Little Transfer', 'Make an acquisition for the house',
];
const PUNISH_SEED: ItemSeed[] = [
  ['Late to an Exec meeting (unexcused)', -1], ['Outstanding Fines', -2], ['Missing Chapter', -2], ['Late Dues', -2],
  ['Skipping a committee meeting (unexcused)', -3], ['Missing Hash Shift', -3], ['Skipping Minor PKP Responsibility', -3],
  ['Skipping an Exec meeting (unexcused)', -3], ['Skipping a Rush Event', -4], ['Missing a party shift', -5],
  ['Skipping Major PKP Responsibility', -8], ['Unpaid Dues Outstanding (temporary until paid)', -8],
  ['Missing a Sober Shift', -15], ['Drinking as a Sober Monitor', -15], ['Breaking Phi Psi rules/conduct', -15],
];

export const mockPointItems: PointItem[] = [
  ...REWARD_SEED.map(([label, points], i): PointItem => ({ id: `pi-r${i + 1}`, label, points, kind: 'reward', discretionary: false })),
  ...DISCRETIONARY_SEED.map((label, i): PointItem => ({ id: `pi-d${i + 1}`, label, points: 0, kind: 'reward', discretionary: true })),
  ...PUNISH_SEED.map(([label, points], i): PointItem => ({ id: `pi-p${i + 1}`, label, points, kind: 'punishment', discretionary: false })),
];

// Engagement 1→0 by the member's roster points rank, so the strong contributors
// rack up more (and bigger) entries and the disengaged drift toward / below zero.
const rankOrder = SEED.map((s, i) => ({ i, p: s.points })).sort((a, b) => b.p - a.p);
const engagementById = new Map<string, number>(
  rankOrder.map((e, rank) => [`mock-${e.i + 1}`, SEED.length > 1 ? 1 - rank / (SEED.length - 1) : 1]),
);

const REWARDS = mockPointItems.filter((it) => it.kind === 'reward' && !it.discretionary);
const BIG = REWARDS.filter((it) => it.points >= 8).sort((a, b) => b.points - a.points); // prestige items, biggest first
const COMMON = REWARDS.filter((it) => it.points < 8);
const PUNISHMENTS = mockPointItems.filter((it) => it.kind === 'punishment');
const APPROVERS = ['Marcus Chen', 'Aisha Patel', 'Diego Ramirez'];

// Build a member's log from their engagement score. The *counts* scale with
// engagement (not a per-entry coin flip), so totals track standing with low
// variance: the engaged earn more — and bigger — items, the disengaged accrue
// punishments and drift toward the -5 floor. Big rewards are the prestige items
// (top-N); common/punishment items rotate from a per-member offset for variety.
function genEntries(id: string, e: number): PointEntry[] {
  const out: PointEntry[] = [];
  const nBig = Math.round(e * 4.5);
  const nCommon = Math.round(2 + e * 8);
  const nP = Math.round((1 - e) * 4);
  let k = 0;
  const push = (item: PointItem) => {
    // ~20% of entries land in the trailing week (varied per member, so weekChange
    // and "member of the month" aren't uniform); the rest spread across the quarter.
    const recent = seededUnit(`${id}-pr${k}`) < 0.2;
    const ago = recent ? Math.floor(seededUnit(`${id}-pd${k}`) * 7) : 7 + Math.floor(seededUnit(`${id}-pd${k}`) * 63);
    const d = new Date(NOW);
    d.setDate(d.getDate() - ago);
    d.setHours(12, 0, 0, 0);
    out.push({
      id: `${id}-pe${k}`, membershipId: id, itemId: item.id, label: item.label, points: item.points,
      date: d.toISOString(), approvedBy: APPROVERS[Math.floor(seededUnit(`${id}-pa${k}`) * APPROVERS.length)],
    });
    k += 1;
  };
  for (let j = 0; j < nBig; j++) push(BIG[j % BIG.length]);
  const co = Math.floor(seededUnit(`${id}-co`) * COMMON.length);
  for (let j = 0; j < nCommon; j++) push(COMMON[(co + j) % COMMON.length]);
  const po = Math.floor(seededUnit(`${id}-po`) * PUNISHMENTS.length);
  for (let j = 0; j < nP; j++) push(PUNISHMENTS[(po + j) % PUNISHMENTS.length]);
  return out;
}

export const mockPointEntries: PointEntry[] = SEED.flatMap((_, i) => {
  const id = `mock-${i + 1}`;
  return genEntries(id, engagementById.get(id) ?? 0.5);
});

const pointsById = new Map<string, number>(
  SEED.map((_, i) => { const id = `mock-${i + 1}`; return [id, memberPointTotal(mockPointEntries, id)]; }),
);

export const mockMembers: MemberRow[] = SEED.map((s, i) => {
  const id = `mock-${i + 1}`;
  const pct = attendancePctFrom(attendanceByMember.get(id) ?? []);
  return {
    membershipId: id,
    fullName: s.name,
    email: s.email,
    phone: s.phone,
    position: s.position,
    roleLabel: roleLabel(s),
    status: s.status,
    classYear: s.classYear,
    committee: s.committee,
    bigName: s.big,
    littleNames: littlesByBig[s.name] ?? [],
    points: pointsById.get(id) ?? 0,
    attendancePct: pct,
    balanceCents: balanceFor(s.dues),
    chargedCents: 85000,
    paidCents: 85000 - balanceFor(s.dues),
    duesState: s.dues,
    flags: flagsFor(s, i, pct),
  };
});

export function mockStats(): ChapterStats {
  const m = mockMembers;
  const sum = (f: (x: MemberRow) => number) => m.reduce((a, x) => a + f(x), 0);
  const active = m.filter((x) => x.status !== 'inactive');
  return {
    activeMembers: active.length,
    totalMembers: m.length,
    paidCount: m.filter((x) => x.duesState === 'paid').length,
    partialCount: m.filter((x) => x.duesState === 'partial').length,
    dueCount: m.filter((x) => x.duesState === 'due').length,
    collectedCents: sum((x) => 85000 - x.balanceCents),
    targetCents: 85000 * m.length,
    avgAttendancePct: Math.round(sum((x) => (x.status !== 'inactive' ? x.attendancePct : 0)) / active.length),
  };
}

/* ─────────────────────────── Events ───────────────────────────
   Five upcoming + three past events, dated relative to the NOW anchor so the
   upcoming/past split stays stable. Aggregate RSVP counts are summed over the
   active roster (deterministic via rsvpFor) — the per-member RSVP/attendance the
   screens need is derived the same way at render time. */

type EventSeed = {
  id: string; title: string; type: EventType; offsetDays: number; hour: number;
  durHrs: number; location: string; description: string; mandatory: boolean; points: number;
};

const EVENT_SEED: EventSeed[] = [
  { id: 'evt-1', title: 'Brotherhood Bowling Night', type: 'brotherhood', offsetDays: 1, hour: 21, durHrs: 2, location: 'Strike Lanes — Downtown', description: 'Casual brotherhood night out. Two lanes reserved; first round is on the social budget. Bring a new member.', mandatory: false, points: 10 },
  { id: 'evt-2', title: 'Weekly Chapter Meeting', type: 'meeting', offsetDays: 3, hour: 19, durHrs: 1.5, location: 'Chapter House — Great Room', description: 'Mandatory weekly business meeting. Committee reports, dues reminders, and a vote on the Founders Day formal budget.', mandatory: true, points: 10 },
  { id: 'evt-3', title: 'Habitat for Humanity Build', type: 'philanthropy', offsetDays: 6, hour: 9, durHrs: 4, location: 'Build Site — 1400 Mission St', description: 'Morning build day with Habitat. Counts for 4 philanthropy hours. Wear closed-toe shoes; breakfast provided.', mandatory: false, points: 25 },
  { id: 'evt-4', title: 'Risk Management Seminar', type: 'mandatory', offsetDays: 8, hour: 18, durHrs: 1.5, location: 'Chapter House — Great Room', description: 'Required risk-management and Title IX seminar led by the national HQ representative. Attendance is recorded for compliance.', mandatory: true, points: 10 },
  { id: 'evt-5', title: 'Founders Day Formal', type: 'social', offsetDays: 12, hour: 20, durHrs: 4, location: 'Rosewood Ballroom', description: 'Annual Founders Day formal. Bids close Friday — RSVP with your guest count so we can finalize the seating chart.', mandatory: false, points: 15 },
  { id: 'evt-6', title: 'Alumni Spring BBQ', type: 'brotherhood', offsetDays: -4, hour: 12, durHrs: 3, location: 'Chapter House — Backyard', description: 'Annual alumni networking BBQ. Great turnout from the founding class. Photos posted in the chapter drive.', mandatory: false, points: 10 },
  { id: 'evt-7', title: 'Weekly Chapter Meeting', type: 'meeting', offsetDays: -4, hour: 19, durHrs: 1.5, location: 'Chapter House — Great Room', description: 'Held elections for the spring formal committee and approved the philanthropy calendar.', mandatory: true, points: 10 },
  { id: 'evt-8', title: 'Beach Cleanup', type: 'service', offsetDays: -11, hour: 10, durHrs: 3, location: 'Ocean Beach — Lot C', description: 'Coastal cleanup with the campus service council. Logged 36 service hours for the chapter.', mandatory: false, points: 20 },
];

export const mockEvents: EventRow[] = EVENT_SEED.map((e) => {
  const start = new Date(NOW);
  start.setDate(start.getDate() + e.offsetDays);
  start.setHours(e.hour, 0, 0, 0);
  const end = new Date(start);
  end.setMinutes(end.getMinutes() + e.durHrs * 60);

  const rsvp = { going: 0, maybe: 0, no: 0 };
  for (const m of mockMembers) {
    if (m.status === 'inactive') continue;
    const r = rsvpFor(m.membershipId, e.id, e.type, e.mandatory);
    if (r) rsvp[r] += 1;
  }

  return {
    id: e.id, title: e.title, type: e.type,
    startsAt: start.toISOString(), endsAt: end.toISOString(),
    location: e.location, description: e.description,
    mandatory: e.mandatory, pointsValue: e.points, rsvp,
  };
});

/* ─────────────────────────── Announcements ───────────────────────────
   Chapter feed, dated relative to NOW. One pinned, one officers-only. */

const ann = (offsetDays: number, hour: number): string => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

export const mockAnnouncements: AnnouncementRow[] = [
  { id: 'ann-1', title: 'Spring dues are past due for 3 brothers', body: 'Reminders went out this morning. If your balance shows as overdue on the Finances tab, please settle it before Friday’s chapter meeting to avoid a late fee. Reach out to me directly if you need a payment plan.', author: 'Aisha Patel', authorRole: 'Treasurer', createdAt: ann(-1, 9), audience: 'all', pinned: true, category: 'finance' },
  { id: 'ann-2', title: 'Founders Day Formal — RSVP by Friday', body: 'The formal is two weeks out at the Rosewood Ballroom. Add your guest count on the Events tab so we can lock the seating chart and final headcount with the venue.', author: 'Tyler Brooks', authorRole: 'Social Chair', createdAt: ann(-2, 17), audience: 'all', pinned: false, category: 'event' },
  { id: 'ann-3', title: 'Habitat build needs 4 more volunteers', body: 'We have six signed up for Saturday’s Habitat for Humanity build and need ten. It’s four philanthropy hours and an easy way to hit your spring requirement. Sign up on the Events tab.', author: 'Noah Williams', authorRole: 'Philanthropy Chair', createdAt: ann(-3, 12), audience: 'all', pinned: false, category: 'event' },
  { id: 'ann-4', title: 'Officers: budget review before Thursday', body: 'Exec board — please review the draft Q3 budget in the shared drive and leave comments before our Thursday sync. We’re finalizing the formal and philanthropy line items.', author: 'Marcus Chen', authorRole: 'President', createdAt: ann(-4, 20), audience: 'officers', pinned: false, category: 'general' },
  { id: 'ann-5', title: 'Risk management seminar is mandatory', body: 'Next week’s risk-management and Title IX seminar is required for all members — attendance is recorded for nationals. Unexcused absences carry a standards fine. No exceptions this term.', author: 'Liam Foster', authorRole: 'Risk Manager', createdAt: ann(-6, 11), audience: 'all', pinned: false, category: 'urgent' },
];

/* ─────────────────────────── Recruitment / Rush CRM ───────────────────────────
   Twelve PNMs spread across the rush funnel. Ratings and vote tallies are derived
   from an intrinsic `score` (deterministic) so the analytics stay coherent; notes
   come from lib/recruitment.ts. referredBy points at real brothers. */

type PnmSeed = {
  name: string; standing: string; major: string; referredBy: string | null;
  stage: PnmStage; score: number; events: number;
};

const PNM_SEED: PnmSeed[] = [
  { name: 'Gabriel Brandt', standing: 'Freshman',  major: 'Biology',                referredBy: 'Diego Ramirez', stage: 'accepted',  score: 91, events: 5 },
  { name: 'Aiden Walsh',    standing: 'Sophomore', major: 'Computer Science',       referredBy: 'Marcus Chen',   stage: 'bid',       score: 88, events: 4 },
  { name: 'Nathan Vance',   standing: 'Sophomore', major: 'Civil Engineering',      referredBy: 'Ethan Park',    stage: 'bid',       score: 85, events: 4 },
  { name: 'Kai Sullivan',   standing: 'Freshman',  major: 'Economics',              referredBy: 'Tyler Brooks',  stage: 'voting',    score: 82, events: 3 },
  { name: 'Lucas Tran',     standing: 'Freshman',  major: 'Chemistry',              referredBy: 'Noah Williams', stage: 'voting',    score: 79, events: 3 },
  { name: 'Jaylen Carter',  standing: 'Sophomore', major: 'Mechanical Engineering', referredBy: null,            stage: 'interview', score: 74, events: 2 },
  { name: 'Theo Stone',     standing: 'Sophomore', major: 'History',                referredBy: 'Jordan Avery',  stage: 'interview', score: 71, events: 2 },
  { name: 'Ryan Okafor',    standing: 'Junior',    major: 'Business',               referredBy: 'Aisha Patel',   stage: 'invited',   score: 68, events: 1 },
  { name: 'Isaiah Moreno',  standing: 'Junior',    major: 'Psychology',             referredBy: 'Liam Foster',   stage: 'invited',   score: 63, events: 2 },
  { name: 'Mason Delgado',  standing: 'Sophomore', major: 'Political Science',      referredBy: null,            stage: 'prospect',  score: 55, events: 0 },
  { name: 'Dylan Hayes',    standing: 'Freshman',  major: 'Undeclared',             referredBy: null,            stage: 'prospect',  score: 47, events: 1 },
  { name: 'Brandon Ross',   standing: 'Freshman',  major: 'Mathematics',            referredBy: null,            stage: 'declined',  score: 36, events: 1 },
];

const ACTIVE_VOTERS = 11;
const hasVote = (s: PnmStage) => s === 'voting' || s === 'bid' || s === 'accepted' || s === 'declined';

export const mockPnms: PnmRow[] = PNM_SEED.map((p, i) => {
  const id = `pnm-${i + 1}`;
  const votesYes = hasVote(p.stage)
    ? p.stage === 'declined' ? Math.round(ACTIVE_VOTERS * 0.45) : Math.round((p.score / 100) * ACTIVE_VOTERS)
    : 0;
  return {
    id,
    fullName: p.name,
    standing: p.standing,
    major: p.major,
    email: `${p.name.toLowerCase().replace(/[^a-z]+/g, '.')}@stanford.edu`,
    phone: `(650) 555-0${300 + i}`,
    referredBy: p.referredBy,
    stage: p.stage,
    rating: Math.round((2.6 + (p.score / 100) * 2.3) * 10) / 10,
    ratingCount: 3 + Math.floor(seededUnit(`${id}-rc`) * 7),
    votesYes,
    votesNo: hasVote(p.stage) ? ACTIVE_VOTERS - votesYes : 0,
    eventsAttended: p.events,
  };
});

/* ─────────────────────────────── Files (Drive) ─────────────────────────────── */

// ISO timestamp `d` days before the demo clock, for realistic "modified" dates.
const daysAgo = (d: number): string => new Date(NOW.getTime() - d * 864e5).toISOString();
const KB = 1024;
const MB = 1024 * KB;

// A flat list; `parentId` builds the tree. Root folders first, then their files.
export const mockFiles: DriveItem[] = [
  // ── Top-level folders ──
  { id: 'f-gov',     name: 'Governance',            kind: 'folder', parentId: null, audience: 'all',      ownerName: 'Marcus Chen',   updatedAt: daysAgo(12), sizeBytes: null },
  { id: 'f-fin',     name: 'Finances',              kind: 'folder', parentId: null, audience: 'officers', ownerName: 'Aisha Patel',   updatedAt: daysAgo(3),  sizeBytes: null },
  { id: 'f-recruit', name: 'Recruitment',           kind: 'folder', parentId: null, audience: 'all',      ownerName: 'Jordan Avery',  updatedAt: daysAgo(5),  sizeBytes: null },
  { id: 'f-events',  name: 'Events & Socials',      kind: 'folder', parentId: null, audience: 'all',      ownerName: 'Tyler Brooks',  updatedAt: daysAgo(2),  sizeBytes: null },
  { id: 'f-nme',     name: 'New Member Education',  kind: 'folder', parentId: null, audience: 'all',      ownerName: 'Ethan Park',    updatedAt: daysAgo(20), sizeBytes: null },
  { id: 'f-risk',    name: 'Risk Management',       kind: 'folder', parentId: null, audience: 'all',      ownerName: 'Liam Foster',   updatedAt: daysAgo(8),  sizeBytes: null },
  { id: 'f-photos',  name: 'Photos',                kind: 'folder', parentId: null, audience: 'all',      ownerName: 'Noah Williams', updatedAt: daysAgo(1),  sizeBytes: null },

  // ── Governance ──
  { id: 'd-bylaws',  name: 'Cal Beta Bylaws 2025.pdf',        kind: 'pdf',   parentId: 'f-gov', audience: 'all',      ownerName: 'Marcus Chen', updatedAt: daysAgo(40),  sizeBytes: 292 * KB },
  { id: 'd-const',   name: 'Chapter Constitution.pdf',        kind: 'pdf',   parentId: 'f-gov', audience: 'all',      ownerName: 'Marcus Chen', updatedAt: daysAgo(120), sizeBytes: 180 * KB },
  { id: 'd-transit', name: 'Officer Transition Guide.docx',   kind: 'doc',   parentId: 'f-gov', audience: 'officers', ownerName: 'Marcus Chen', updatedAt: daysAgo(12),  sizeBytes: 44 * KB },
  { id: 'd-roster',  name: 'Active Roster.xlsx',              kind: 'sheet', parentId: 'f-gov', audience: 'all',      ownerName: 'Ethan Park',  updatedAt: daysAgo(6),   sizeBytes: 28 * KB },

  // ── Finances (officers-only) ──
  { id: 'd-budget',  name: 'Spring 2026 Budget.xlsx',         kind: 'sheet', parentId: 'f-fin', audience: 'officers', ownerName: 'Aisha Patel', updatedAt: daysAgo(3),   sizeBytes: 66 * KB },
  { id: 'd-ledger',  name: 'Dues Ledger.xlsx',                kind: 'sheet', parentId: 'f-fin', audience: 'officers', ownerName: 'Aisha Patel', updatedAt: daysAgo(3),   sizeBytes: 51 * KB },
  { id: 'd-reimb',   name: 'Reimbursement Request Form.pdf',  kind: 'pdf',   parentId: 'f-fin', audience: 'officers', ownerName: 'Aisha Patel', updatedAt: daysAgo(30),  sizeBytes: 88 * KB },

  // ── Recruitment ──
  { id: 'd-rushcal', name: 'Rush Schedule — Spring 2026.pdf', kind: 'pdf',   parentId: 'f-recruit', audience: 'all', ownerName: 'Jordan Avery', updatedAt: daysAgo(5),  sizeBytes: 140 * KB },
  { id: 'd-pnm',     name: 'PNM Tracker.xlsx',                kind: 'sheet', parentId: 'f-recruit', audience: 'all', ownerName: 'Jordan Avery', updatedAt: daysAgo(1),  sizeBytes: 73 * KB },
  { id: 'd-bidcard', name: 'Bid Card Template.docx',          kind: 'doc',   parentId: 'f-recruit', audience: 'all', ownerName: 'Jordan Avery', updatedAt: daysAgo(18), sizeBytes: 22 * KB },
  { id: 'd-flyer',   name: 'Rush Flyer.png',                  kind: 'image', parentId: 'f-recruit', audience: 'all', ownerName: 'Tyler Brooks', updatedAt: daysAgo(9),  sizeBytes: 1.4 * MB },

  // ── Events & Socials ──
  { id: 'd-formal',  name: 'Founders Day Formal — Planning.xlsx', kind: 'sheet', parentId: 'f-events', audience: 'all', ownerName: 'Tyler Brooks',  updatedAt: daysAgo(2),  sizeBytes: 59 * KB },
  { id: 'd-soccal',  name: 'Social Calendar.pdf',                 kind: 'pdf',   parentId: 'f-events', audience: 'all', ownerName: 'Tyler Brooks',  updatedAt: daysAgo(4),  sizeBytes: 96 * KB },
  { id: 'd-phil',    name: 'Philanthropy 5K Run of Show.docx',    kind: 'doc',   parentId: 'f-events', audience: 'all', ownerName: 'Noah Williams', updatedAt: daysAgo(7),  sizeBytes: 31 * KB },

  // ── New Member Education ──
  { id: 'd-pledge',  name: 'Formal Pledge Ceremony 2025.pdf',  kind: 'pdf', parentId: 'f-nme', audience: 'all', ownerName: 'Ethan Park', updatedAt: daysAgo(60), sizeBytes: 156 * KB },
  { id: 'd-manual',  name: 'New Member Manual.pdf',            kind: 'pdf', parentId: 'f-nme', audience: 'all', ownerName: 'Ethan Park', updatedAt: daysAgo(45), sizeBytes: 2.4 * MB },
  { id: 'd-biglil',  name: 'Big–Little Pairing Guide.docx',    kind: 'doc', parentId: 'f-nme', audience: 'all', ownerName: 'Ethan Park', updatedAt: daysAgo(22), sizeBytes: 19 * KB },

  // ── Risk Management ──
  { id: 'd-riskform', name: 'Event Attendance Form.pdf',       kind: 'pdf', parentId: 'f-risk', audience: 'all', ownerName: 'Liam Foster', updatedAt: daysAgo(8),  sizeBytes: 214 * KB },
  { id: 'd-riskpol',  name: 'Risk Management Policy.pdf',      kind: 'pdf', parentId: 'f-risk', audience: 'all', ownerName: 'Liam Foster', updatedAt: daysAgo(90), sizeBytes: 130 * KB },

  // ── Photos ──
  { id: 'd-comp',    name: 'Composite 2025.jpg',   kind: 'image', parentId: 'f-photos', audience: 'all', ownerName: 'Noah Williams', updatedAt: daysAgo(50), sizeBytes: 3.2 * MB },
  { id: 'd-lawn',    name: 'Lawn Day.jpg',         kind: 'image', parentId: 'f-photos', audience: 'all', ownerName: 'Noah Williams', updatedAt: daysAgo(15), sizeBytes: 2.1 * MB },
  { id: 'd-formalp', name: 'Formal — Group.jpg',   kind: 'image', parentId: 'f-photos', audience: 'all', ownerName: 'Noah Williams', updatedAt: daysAgo(1),  sizeBytes: 4.6 * MB },
];
