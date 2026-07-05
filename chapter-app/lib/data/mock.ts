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
  bigs: string[];  // lineage: this member's big(s); [] = none, 2 = twin bigs
  dues: MemberRow['duesState'];
};

const SEED: Seed[] = [
  { name: 'Joshua Koch', email: 'jmkoch@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Kyle Schmoyer'], dues: 'paid' },
  { name: 'Saul Hernandez Vigil', email: 'saulh22@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Alexander Daix'], dues: 'paid' },
  { name: 'Lundeen Cahilly', email: 'lcahilly@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Jonathan Tubb'], dues: 'paid' },
  { name: 'Graham Johnstone', email: 'grahamjo@stanford.edu', phone: '', position: null, status: 'active', classYear: 2026, committee: '', bigs: ['Chehan Wijayaratne'], dues: 'paid' },
  { name: 'Zachary Ewing', email: 'zpewing@stanford.edu', phone: '', position: 'Treasurer', status: 'active', classYear: 2027, committee: '', bigs: ['Michael Hemker'], dues: 'paid' },
  { name: 'Sam Shors', email: 'samshors@stanford.edu', phone: '', position: null, status: 'active', classYear: 2026, committee: '', bigs: ['Nolan Mejia'], dues: 'paid' },
  { name: 'Sam Cousins', email: 'cousinss@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Bradley Bush'], dues: 'paid' },
  { name: 'Andrew Leick', email: 'aleick@stanford.edu', phone: '', position: 'Corresponding Secretary', status: 'active', classYear: 2028, committee: '', bigs: ['Sam Jonker'], dues: 'paid' },
  { name: 'Benji Warburton', email: 'benjiw@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Panos Papanastasiou'], dues: 'paid' },
  { name: 'Cooper Tenney', email: 'ctenney@stanford.edu', phone: '', position: 'Sergeant at Arms', status: 'active', classYear: 2028, committee: '', bigs: ['Saul Hernandez Vigil'], dues: 'paid' },
  { name: 'Eddy Duran', email: 'endur@stanford.edu', phone: '', position: 'President', status: 'active', classYear: 2027, committee: '', bigs: ['James Ubi'], dues: 'paid' },
  { name: 'Efrain Angon-Cruz', email: 'efrainac@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Milo Golding'], dues: 'paid' },
  { name: 'Kyle Schmoyer', email: 'kyles7@stanford.edu', phone: '', position: null, status: 'active', classYear: 2026, committee: '', bigs: ['Gareth Cockroft'], dues: 'paid' },
  { name: 'Tuvana Soronzonbold', email: 'tuvana@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Dean Cureton'], dues: 'paid' },
  { name: 'Mateo Solis', email: 'mtsolis@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Alexander Belfiore'], dues: 'paid' },
  { name: 'Jose Berdeja', email: 'jcberdej@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Jonathan Morales'], dues: 'paid' },
  { name: 'Vivek Yarlagedda', email: 'viveky@stanford.edu', phone: '', position: 'Vice President', status: 'active', classYear: 2028, committee: '', bigs: ['Mateo Solis'], dues: 'paid' },
  { name: 'Panos Papanastasiou', email: 'panapap@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Lichu Acuna'], dues: 'paid' },
  { name: 'Taden Horse', email: 'tadenh@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: [], dues: 'paid' },
  { name: 'Arjin Claire', email: 'aclaire@stanford.edu', phone: '', position: null, status: 'active', classYear: 2026, committee: '', bigs: ['Anthony Chen'], dues: 'paid' },
  { name: 'Jackson Moyer', email: 'jdmoyer@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Zachary Ewing'], dues: 'paid' },
  { name: 'Alex Wohlberg', email: 'wohlberg@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Ben McAulay'], dues: 'paid' },
  { name: 'Brooks Modesitt', email: 'modesitt@stanford.edu', phone: '', position: 'Messenger', status: 'active', classYear: 2028, committee: '', bigs: ['Carter Dessommes'], dues: 'paid' },
  { name: 'Jasper Karlson', email: 'jkarlson@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Dilan Gohill'], dues: 'paid' },
  { name: 'Owen Grossman', email: 'owengrossman@stanford.edu', phone: '', position: 'Historian', status: 'active', classYear: 2028, committee: '', bigs: ['Eddy Duran'], dues: 'paid' },
  { name: 'Connor Lee', email: 'connor1@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Ping Tankongchamruskul'], dues: 'paid' },
  { name: 'Ben McAulay', email: 'ooo@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Odin Farkas'], dues: 'paid' },
  { name: 'Blake Pigott', email: 'bpigott@stanford.edu', phone: '', position: null, status: 'active', classYear: 2026, committee: '', bigs: ['Nick Dietrich'], dues: 'paid' },
  { name: 'Chris Vinasco-Gomez', email: 'chrisvg@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Benjamin Chen'], dues: 'paid' },
  { name: 'Jonas Pao', email: 'jonaspao@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Adri Arquin'], dues: 'paid' },
  { name: 'James Ubi', email: 'jamesu72@stanford.edu', phone: '', position: null, status: 'active', classYear: 2026, committee: '', bigs: ['Esteban Herrera-Vendrell'], dues: 'paid' },
  { name: 'Dean Cureton', email: 'dcureton@stanford.edu', phone: '', position: 'Recording Secretary', status: 'active', classYear: 2026, committee: '', bigs: ['Ethan Kirgan'], dues: 'paid' },
  { name: 'Shawn Gregory', email: 'shawng28@stanford.edu', phone: '', position: 'Chaplain', status: 'active', classYear: 2028, committee: '', bigs: ['Arjin Claire', 'Aaron Tiao'], dues: 'paid' },
  { name: 'Zack Ryan', email: 'zackryan@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Garin Gross'], dues: 'paid' },
  { name: 'Michael Hemker', email: 'mjhemker@stanford.edu', phone: '', position: null, status: 'active', classYear: 2026, committee: '', bigs: ['Ezra Kohrman'], dues: 'paid' },
  { name: 'Mercer Weis', email: 'mweis2@stanford.edu', phone: '', position: null, status: 'active', classYear: 2026, committee: '', bigs: ['Ethan Tiao'], dues: 'paid' },
  { name: 'Gerardo Murga', email: 'gmurga@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Eddy Duran'], dues: 'paid' },
  { name: 'Peter McGinnes', email: 'petermcg@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['George Porteous'], dues: 'paid' },
  { name: 'Dean Liang', email: 'deanl@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Jason Zhang'], dues: 'paid' },
  { name: 'Griffin Lee', email: 'griffin2@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Zack Ryan'], dues: 'paid' },
  { name: 'Alexander Daix', email: 'asdaix@stanford.edu', phone: '', position: null, status: 'active', classYear: 2026, committee: '', bigs: ['Dhruv Sumathi'], dues: 'paid' },
  { name: 'Alejandro Darbeloff', email: 'aledarb@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Connor Lee'], dues: 'paid' },
  { name: 'Noé Martínez', email: 'noemtz@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Efrain Angon-Cruz'], dues: 'paid' },
  { name: 'Dylan Sih', email: 'dsih@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Henry Boeschen'], dues: 'paid' },
  { name: 'Thijs Simonian', email: 'thijs@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Joshua Koch'], dues: 'paid' },
  { name: 'Patrick Walsh', email: 'walshp26@stanford.edu', phone: '', position: null, status: 'active', classYear: 2026, committee: '', bigs: ['Michael Chhay'], dues: 'paid' },
  { name: 'Abraham Yeung', email: 'ayeung16@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Zaydan Amanullah'], dues: 'paid' },
  { name: 'Alexander Belfiore', email: 'abelfior@stanford.edu', phone: '', position: null, status: 'active', classYear: 2026, committee: '', bigs: ['Ethan Kato'], dues: 'paid' },
  { name: 'Carlos Valencia Garcia', email: 'carlov@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Jose Berdeja'], dues: 'paid' },
  { name: 'Michael Dolan', email: 'mbdolan@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Jonas Pao'], dues: 'paid' },
  { name: 'Josh Barsoian', email: 'joshbars@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Benji Welner'], dues: 'paid' },
  { name: 'Carter Dessommes', email: 'carterd1@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Graham Johnstone'], dues: 'paid' },
  { name: 'Jonathan Morales', email: 'jonath4n@stanford.edu', phone: '', position: null, status: 'active', classYear: 2026, committee: '', bigs: ['Sam Kwok', 'Yahir Ruiz'], dues: 'paid' },
  { name: 'Jai Agrawal', email: 'jka@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Kristopher Luo'], dues: 'paid' },
  { name: 'Christian Pierre', email: 'cpierre@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Yannick Mofor'], dues: 'paid' },
  { name: 'Aaron Lee', email: 'aaroncl@stanford.edu', phone: '', position: null, status: 'active', classYear: 2026, committee: '', bigs: ['Sidd Wali'], dues: 'paid' },
  { name: 'Dilan Gohill', email: 'dgohill@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Nick Buckovich'], dues: 'paid' },
  { name: 'Jonathan Tubb', email: 'jmtubb1@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Ethan Bernheim'], dues: 'paid' },
  { name: 'Zhikai Huang', email: 'zkhuang@stanford.edu', phone: '', position: null, status: 'active', classYear: 2028, committee: '', bigs: ['Aaron Lee'], dues: 'paid' },
  { name: 'George Porteous', email: 'gport@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Patrick Walsh'], dues: 'paid' },
  { name: 'Bradley Bush', email: 'bkbush@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Theo Snoey'], dues: 'paid' },
  { name: 'Henry Boeschen', email: 'hdboesch@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Deveen Harsichandra'], dues: 'paid' },
  { name: 'Aaron Tiao', email: 'atiao@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Maxim Ivanov'], dues: 'paid' },
  { name: 'Benjamin Chen', email: 'benbchen@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Sam Shors'], dues: 'paid' },
  { name: 'Sam Jonker', email: 'sjonker@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Mercer Weis'], dues: 'paid' },
  { name: 'Zaydan Amanullah', email: 'zaydanka@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Blake Pigott'], dues: 'paid' },
  { name: 'Jason Zhang', email: 'jasonbz@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Michael Brockman'], dues: 'paid' },
  { name: 'Yannick Mofor', email: 'yannickm@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Titus Parker'], dues: 'paid' },
  { name: 'Kristopher Luo', email: 'krisluo@stanford.edu', phone: '', position: null, status: 'active', classYear: 2027, committee: '', bigs: ['Andrew Park'], dues: 'paid' },
  { name: 'Ben Vu', email: 'benvu@stanford.edu', phone: '', position: null, status: 'new', classYear: 2028, committee: '', bigs: ['Griffin Lee'], dues: 'paid' },
  { name: 'Bison McCotter-Hulett', email: 'bisonmh@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Jackson Moyer'], dues: 'paid' },
  { name: 'Burkson Montague-Alamin', email: 'burkema@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Alex Wohlberg'], dues: 'paid' },
  { name: 'Carson Packard', email: 'cwason06@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Thijs Simonian'], dues: 'paid' },
  { name: 'Connor Engstrom', email: 'connorfe@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Vivek Yarlagedda'], dues: 'paid' },
  { name: 'Benjamin Schindler', email: 'bschind@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Benji Warburton'], dues: 'paid' },
  { name: 'Sanjay De Silva', email: 'sanjayde@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Andrew Leick'], dues: 'paid' },
  { name: 'William Maher', email: 'wmaher@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Brooks Modesitt'], dues: 'paid' },
  { name: 'Shrish Premkrishna', email: 'shrishp@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Shawn Gregory'], dues: 'paid' },
  { name: 'Charles Simonian', email: 'csimonia@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Josh Barsoian'], dues: 'paid' },
  { name: 'Tej Kosaraju', email: 'tejk@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Andrew Leick'], dues: 'paid' },
  { name: 'Arun Tamura', email: 'atamura@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Owen Grossman'], dues: 'paid' },
  { name: 'Angel Zavala', email: 'angelzav@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Sam Cousins'], dues: 'paid' },
  { name: 'Rhett Hounsell', email: 'rhett@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Jackson Moyer'], dues: 'paid' },
  { name: 'Ryan Tellado', email: 'rtellado@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Zhikai Huang'], dues: 'paid' },
  { name: 'Aaron Henschel', email: 'aaronh29@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Sam Cousins'], dues: 'paid' },
  { name: 'Kushal Patel', email: 'kushalp@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Lundeen Cahilly'], dues: 'paid' },
  { name: 'Nigel Willacy', email: 'nwillacy@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Noé Martínez'], dues: 'paid' },
  { name: 'Joseph Zhang', email: 'josephz2@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Christian Pierre'], dues: 'paid' },
  { name: 'Jan Dwayne Cacnio', email: 'dwy@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Owen Grossman'], dues: 'paid' },
  { name: 'Marlon Moenius', email: 'marlonm@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Michael Dolan'], dues: 'paid' },
  { name: 'August Hazel', email: 'amghazel@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Peter McGinnes'], dues: 'paid' },
  { name: 'Jason Wang', email: 'jiayang5@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Dean Liang'], dues: 'paid' },
  { name: 'Gael Martinez', email: 'gael15@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Chris Vinasco-Gomez'], dues: 'paid' },
  { name: 'Daniel Tauhert', email: 'dtauhert@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Dean Liang'], dues: 'paid' },
  { name: 'Clifford Palmer', email: 'cwpalmer@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Abraham Yeung'], dues: 'paid' },
  { name: 'Angel Velasquez', email: 'avelasq@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Noé Martínez'], dues: 'paid' },
  { name: 'Diego Seligman-Tovar', email: 'diegosel@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Alejandro Darbeloff'], dues: 'paid' },
  { name: 'Martin Amaya', email: 'mamayag@stanford.edu', phone: '', position: null, status: 'new', classYear: 2028, committee: '', bigs: ['Gerardo Murga'], dues: 'paid' },
  { name: 'Dylan Dominguez', email: 'domingo4@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Jasper Karlson'], dues: 'paid' },
  { name: 'Ivan Ho', email: 'hoivan@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Peter McGinnes'], dues: 'paid' },
  { name: 'Bauer Lee', email: 'bauerlee@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Alejandro Darbeloff'], dues: 'paid' },
  { name: 'Simon Meyers', email: 'shmeyers@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Jai Agrawal'], dues: 'paid' },
  { name: 'Chris Benitez', email: 'cabenitz@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Carlos Valencia Garcia'], dues: 'paid' },
  { name: 'Tyler Rubenstein', email: 'trub@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Cooper Tenney'], dues: 'paid' },
  { name: 'Romir Jain', email: 'romirj@stanford.edu', phone: '', position: null, status: 'new', classYear: 2029, committee: '', bigs: ['Dylan Sih'], dues: 'paid' },
];

const balanceFor = (dues: MemberRow['duesState']) =>
  dues === 'paid' ? 0 : dues === 'partial' ? 35000 : 85000;

const roleLabel = (s: Seed) =>
  s.position ?? (s.status === 'new' ? 'New Member' : 'Brother');

// Invert the big→member relation so each member knows their littles.
const littlesByBig = SEED.reduce<Record<string, string[]>>((acc, s) => {
  for (const b of s.bigs) (acc[b] ??= []).push(s.name);
  return acc;
}, {});

// Manually-set compliance flags (standards board), keyed by member name. These
// merge with the auto-derived ones (overdue dues, low attendance).
const MANUAL_FLAGS: Record<string, Omit<MemberFlag, 'id'>[]> = {};

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
  states: memberAttendance(`mock-${i + 1}`, 100, MEETING_COUNT),
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

// Neutral start: real members carry no seeded point history — the ledger fills
// from live self-logs + exec approvals. Catalog (mockPointItems) stays so the
// Log-points picker works.
export const mockPointEntries: PointEntry[] = [];

const pointsById = new Map<string, number>(
  SEED.map((_, i) => { const id = `mock-${i + 1}`; return [id, memberPointTotal(mockPointEntries, id)]; }),
);

export const mockMembers: MemberRow[] = SEED.map((s, i) => {
  const id = `mock-${i + 1}`;
  const pct = attendancePctFrom(attendanceByMember.get(id) ?? []);
  return {
    membershipId: id,
    fullName: s.name,
    avatarUrl: null,
    email: s.email,
    phone: s.phone,
    position: s.position,
    roleLabel: roleLabel(s),
    status: s.status,
    classYear: s.classYear,
    committee: s.committee,
    bigName: s.bigs.length ? s.bigs.join(' & ') : null,
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
  // Extra socials so the Socials agenda timeline reads across several weeks.
  { id: 'evt-9', title: 'Mixer with Alpha Phi', type: 'social', offsetDays: 2, hour: 21, durHrs: 3, location: 'Chapter House — Great Room', description: 'Co-hosted mixer with Alpha Phi. Theme drops in the group chat Thursday. Sober monitors already assigned.', mandatory: false, points: 3 },
  { id: 'evt-10', title: 'Wing Wednesday', type: 'brotherhood', offsetDays: 4, hour: 19, durHrs: 2, location: 'Wingstop — University Ave', description: 'Low-key brotherhood dinner. Split the tab; bring a new member and points count double toward the brotherhood tier.', mandatory: false, points: 2 },
  { id: 'evt-11', title: 'Big/Little Reveal', type: 'brotherhood', offsetDays: 9, hour: 19, durHrs: 3, location: 'Chapter House — Backyard', description: 'Reveal night for the new pledge class. Bigs, have your reveal boards ready by 6. Chapter photo after.', mandatory: false, points: 5 },
  { id: 'evt-12', title: 'Spring Day Party w/ Kappa', type: 'social', offsetDays: 16, hour: 14, durHrs: 5, location: 'Chapter House — Lawn', description: 'Annual spring day party. Wristbands required at the door; guest list closes the night before. Setup crew at noon.', mandatory: false, points: 3 },
  { id: 'evt-13', title: 'Winter Semiformal', type: 'social', offsetDays: -9, hour: 20, durHrs: 4, location: 'The Foundry — Event Hall', description: 'Winter semiformal. Great turnout — recap photos are up in the chapter drive.', mandatory: false, points: 15 },
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
  { id: 'ann-1', title: 'Spring dues are past due for 3 brothers', body: 'Reminders went out this morning. If your balance shows as overdue on the Finances tab, please settle it before Friday’s chapter meeting to avoid a late fee. Reach out to me directly if you need a payment plan.', author: 'Zachary Ewing', authorRole: 'Treasurer', createdAt: ann(-1, 9), audience: 'all', pinned: true, category: 'finance' },
  { id: 'ann-2', title: 'Founders Day Formal — RSVP by Friday', body: 'The formal is two weeks out at the Rosewood Ballroom. Add your guest count on the Events tab so we can lock the seating chart and final headcount with the venue.', author: 'Vivek Yarlagedda', authorRole: 'Vice President', createdAt: ann(-2, 17), audience: 'all', pinned: false, category: 'event' },
  { id: 'ann-3', title: 'Habitat build needs 4 more volunteers', body: 'We have six signed up for Saturday’s Habitat for Humanity build and need ten. It’s four philanthropy hours and an easy way to hit your spring requirement. Sign up on the Events tab.', author: 'Owen Grossman', authorRole: 'Historian', createdAt: ann(-3, 12), audience: 'all', pinned: false, category: 'event' },
  { id: 'ann-4', title: 'Officers: budget review before Thursday', body: 'Exec board — please review the draft Q3 budget in the shared drive and leave comments before our Thursday sync. We’re finalizing the formal and philanthropy line items.', author: 'Eddy Duran', authorRole: 'President', createdAt: ann(-4, 20), audience: 'officers', pinned: false, category: 'general' },
  { id: 'ann-5', title: 'Risk management seminar is mandatory', body: 'Next week’s risk-management and Title IX seminar is required for all members — attendance is recorded for nationals. Unexcused absences carry a standards fine. No exceptions this term.', author: 'Cooper Tenney', authorRole: 'Sergeant at Arms', createdAt: ann(-6, 11), audience: 'all', pinned: false, category: 'urgent' },
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
  { name: 'Gabriel Brandt', standing: 'Freshman',  major: 'Biology',                referredBy: 'Bradley Bush', stage: 'accepted',  score: 91, events: 5 },
  { name: 'Aiden Walsh',    standing: 'Sophomore', major: 'Computer Science',       referredBy: 'Eddy Duran',   stage: 'bid',       score: 88, events: 4 },
  { name: 'Nathan Vance',   standing: 'Sophomore', major: 'Civil Engineering',      referredBy: 'Andrew Leick',    stage: 'bid',       score: 85, events: 4 },
  { name: 'Kai Sullivan',   standing: 'Freshman',  major: 'Economics',              referredBy: 'Vivek Yarlagedda',  stage: 'voting',    score: 82, events: 3 },
  { name: 'Lucas Tran',     standing: 'Freshman',  major: 'Chemistry',              referredBy: 'Owen Grossman', stage: 'voting',    score: 79, events: 3 },
  { name: 'Jaylen Carter',  standing: 'Sophomore', major: 'Mechanical Engineering', referredBy: null,            stage: 'interview', score: 74, events: 2 },
  { name: 'Theo Stone',     standing: 'Sophomore', major: 'History',                referredBy: 'Brooks Modesitt',  stage: 'interview', score: 71, events: 2 },
  { name: 'Ryan Okafor',    standing: 'Junior',    major: 'Business',               referredBy: 'Zachary Ewing',   stage: 'invited',   score: 68, events: 1 },
  { name: 'Isaiah Moreno',  standing: 'Junior',    major: 'Psychology',             referredBy: 'Cooper Tenney',   stage: 'invited',   score: 63, events: 2 },
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
  { id: 'f-gov',     name: 'Governance',            kind: 'folder', parentId: null, audience: 'all',      ownerName: 'Eddy Duran',   updatedAt: daysAgo(12), sizeBytes: null },
  { id: 'f-fin',     name: 'Finances',              kind: 'folder', parentId: null, audience: 'officers', ownerName: 'Zachary Ewing',   updatedAt: daysAgo(3),  sizeBytes: null },
  { id: 'f-recruit', name: 'Recruitment',           kind: 'folder', parentId: null, audience: 'all',      ownerName: 'Brooks Modesitt',  updatedAt: daysAgo(5),  sizeBytes: null },
  { id: 'f-events',  name: 'Events & Socials',      kind: 'folder', parentId: null, audience: 'all',      ownerName: 'Vivek Yarlagedda',  updatedAt: daysAgo(2),  sizeBytes: null },
  { id: 'f-nme',     name: 'New Member Education',  kind: 'folder', parentId: null, audience: 'all',      ownerName: 'Andrew Leick',    updatedAt: daysAgo(20), sizeBytes: null },
  { id: 'f-risk',    name: 'Risk Management',       kind: 'folder', parentId: null, audience: 'all',      ownerName: 'Cooper Tenney',   updatedAt: daysAgo(8),  sizeBytes: null },
  { id: 'f-photos',  name: 'Photos',                kind: 'folder', parentId: null, audience: 'all',      ownerName: 'Owen Grossman', updatedAt: daysAgo(1),  sizeBytes: null },

  // ── Governance ──
  { id: 'd-bylaws',  name: 'Cal Beta Bylaws 2025.pdf',        kind: 'pdf',   parentId: 'f-gov', audience: 'all',      ownerName: 'Eddy Duran', updatedAt: daysAgo(40),  sizeBytes: 292 * KB },
  { id: 'd-const',   name: 'Chapter Constitution.pdf',        kind: 'pdf',   parentId: 'f-gov', audience: 'all',      ownerName: 'Eddy Duran', updatedAt: daysAgo(120), sizeBytes: 180 * KB },
  { id: 'd-transit', name: 'Officer Transition Guide.docx',   kind: 'doc',   parentId: 'f-gov', audience: 'officers', ownerName: 'Eddy Duran', updatedAt: daysAgo(12),  sizeBytes: 44 * KB },
  { id: 'd-roster',  name: 'Active Roster.xlsx',              kind: 'sheet', parentId: 'f-gov', audience: 'all',      ownerName: 'Andrew Leick',  updatedAt: daysAgo(6),   sizeBytes: 28 * KB },

  // ── Finances (officers-only) ──
  { id: 'd-budget',  name: 'Spring 2026 Budget.xlsx',         kind: 'sheet', parentId: 'f-fin', audience: 'officers', ownerName: 'Zachary Ewing', updatedAt: daysAgo(3),   sizeBytes: 66 * KB },
  { id: 'd-ledger',  name: 'Dues Ledger.xlsx',                kind: 'sheet', parentId: 'f-fin', audience: 'officers', ownerName: 'Zachary Ewing', updatedAt: daysAgo(3),   sizeBytes: 51 * KB },
  { id: 'd-reimb',   name: 'Reimbursement Request Form.pdf',  kind: 'pdf',   parentId: 'f-fin', audience: 'officers', ownerName: 'Zachary Ewing', updatedAt: daysAgo(30),  sizeBytes: 88 * KB },

  // ── Recruitment ──
  { id: 'd-rushcal', name: 'Rush Schedule — Spring 2026.pdf', kind: 'pdf',   parentId: 'f-recruit', audience: 'all', ownerName: 'Brooks Modesitt', updatedAt: daysAgo(5),  sizeBytes: 140 * KB },
  { id: 'd-pnm',     name: 'PNM Tracker.xlsx',                kind: 'sheet', parentId: 'f-recruit', audience: 'all', ownerName: 'Brooks Modesitt', updatedAt: daysAgo(1),  sizeBytes: 73 * KB },
  { id: 'd-bidcard', name: 'Bid Card Template.docx',          kind: 'doc',   parentId: 'f-recruit', audience: 'all', ownerName: 'Brooks Modesitt', updatedAt: daysAgo(18), sizeBytes: 22 * KB },
  { id: 'd-flyer',   name: 'Rush Flyer.png',                  kind: 'image', parentId: 'f-recruit', audience: 'all', ownerName: 'Vivek Yarlagedda', updatedAt: daysAgo(9),  sizeBytes: 1.4 * MB },

  // ── Events & Socials ──
  { id: 'd-formal',  name: 'Founders Day Formal — Planning.xlsx', kind: 'sheet', parentId: 'f-events', audience: 'all', ownerName: 'Vivek Yarlagedda',  updatedAt: daysAgo(2),  sizeBytes: 59 * KB },
  { id: 'd-soccal',  name: 'Social Calendar.pdf',                 kind: 'pdf',   parentId: 'f-events', audience: 'all', ownerName: 'Vivek Yarlagedda',  updatedAt: daysAgo(4),  sizeBytes: 96 * KB },
  { id: 'd-phil',    name: 'Philanthropy 5K Run of Show.docx',    kind: 'doc',   parentId: 'f-events', audience: 'all', ownerName: 'Owen Grossman', updatedAt: daysAgo(7),  sizeBytes: 31 * KB },

  // ── New Member Education ──
  { id: 'd-pledge',  name: 'Formal Pledge Ceremony 2025.pdf',  kind: 'pdf', parentId: 'f-nme', audience: 'all', ownerName: 'Andrew Leick', updatedAt: daysAgo(60), sizeBytes: 156 * KB },
  { id: 'd-manual',  name: 'New Member Manual.pdf',            kind: 'pdf', parentId: 'f-nme', audience: 'all', ownerName: 'Andrew Leick', updatedAt: daysAgo(45), sizeBytes: 2.4 * MB },
  { id: 'd-biglil',  name: 'Big–Little Pairing Guide.docx',    kind: 'doc', parentId: 'f-nme', audience: 'all', ownerName: 'Andrew Leick', updatedAt: daysAgo(22), sizeBytes: 19 * KB },

  // ── Risk Management ──
  { id: 'd-riskform', name: 'Event Attendance Form.pdf',       kind: 'pdf', parentId: 'f-risk', audience: 'all', ownerName: 'Cooper Tenney', updatedAt: daysAgo(8),  sizeBytes: 214 * KB },
  { id: 'd-riskpol',  name: 'Risk Management Policy.pdf',      kind: 'pdf', parentId: 'f-risk', audience: 'all', ownerName: 'Cooper Tenney', updatedAt: daysAgo(90), sizeBytes: 130 * KB },

  // ── Photos ──
  { id: 'd-comp',    name: 'Composite 2025.jpg',   kind: 'image', parentId: 'f-photos', audience: 'all', ownerName: 'Owen Grossman', updatedAt: daysAgo(50), sizeBytes: 3.2 * MB },
  { id: 'd-lawn',    name: 'Lawn Day.jpg',         kind: 'image', parentId: 'f-photos', audience: 'all', ownerName: 'Owen Grossman', updatedAt: daysAgo(15), sizeBytes: 2.1 * MB },
  { id: 'd-formalp', name: 'Formal — Group.jpg',   kind: 'image', parentId: 'f-photos', audience: 'all', ownerName: 'Owen Grossman', updatedAt: daysAgo(1),  sizeBytes: 4.6 * MB },
];
