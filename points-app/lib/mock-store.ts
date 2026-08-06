import { randomUUID } from 'crypto';
import type {
  MemberRow, PointItem, PointEntry, ScoreConfig, Term, MeetingRow, MemberTermStatus, AttendanceState,
} from './types';

// In-memory mock backend, used only when Supabase env vars are absent (see
// lib/config.ts). Module-level state persists for the life of the dev server
// process and resets on restart — no real DB, exactly like the chapter app's
// mock.ts but mutable, since this app has no separate "demo" concept.

interface AttendanceRow { meetingId: string; memberId: string; state: AttendanceState }
interface TermStatusRow { memberId: string; termId: string; kind: 'abroad' | 'excused'; reason: string | null }

const members: MemberRow[] = [
  { id: 'm1', name: 'Alex Chen', photoUrl: null },
  { id: 'm2', name: 'Jordan Reyes', photoUrl: null },
  { id: 'm3', name: 'Sam Patel', photoUrl: null },
  { id: 'm4', name: 'Taylor Kim', photoUrl: null },
];

const pointItems: PointItem[] = [
  { id: 'i1', label: 'Attended social', points: 2, kind: 'reward', discretionary: false, archived: false, sortOrder: 1, maxPerTerm: null, autoTrigger: null },
  { id: 'i2', label: 'Ran a philanthropy event', points: 5, kind: 'reward', discretionary: false, archived: false, sortOrder: 2, maxPerTerm: null, autoTrigger: null },
  { id: 'i3', label: 'Exec discretion (reward)', points: 0, kind: 'reward', discretionary: true, archived: false, sortOrder: 3, maxPerTerm: null, autoTrigger: null },
  { id: 'i4', label: 'Missed chapter (unexcused)', points: -2, kind: 'punishment', discretionary: false, archived: false, sortOrder: 4, maxPerTerm: null, autoTrigger: 'absent' },
  { id: 'i5', label: 'Late to chapter', points: -1, kind: 'punishment', discretionary: false, archived: false, sortOrder: 5, maxPerTerm: null, autoTrigger: 'late' },
  { id: 'i6', label: 'Exec discretion (punishment)', points: 0, kind: 'punishment', discretionary: true, archived: false, sortOrder: 6, maxPerTerm: null, autoTrigger: null },
];

let pointsEntries: PointEntry[] = [];
const meetings: MeetingRow[] = [];
let attendance: AttendanceRow[] = [];
let termStatuses: TermStatusRow[] = [];

const term1Id = 'term1';
const terms: Term[] = [{ id: term1Id, label: 'Term 1', isCurrent: true }];

let settings: ScoreConfig = { floor: -5, ceiling: null };

const currentTerm = () => terms.find((t) => t.isCurrent) ?? null;

/* ─────────────────────────── Reads ─────────────────────────── */

export const mockGetMembers = async (): Promise<MemberRow[]> => [...members].sort((a, b) => a.name.localeCompare(b.name));

export const mockGetPointItems = async (includeArchived = false): Promise<PointItem[]> =>
  pointItems.filter((i) => includeArchived || !i.archived).sort((a, b) => a.sortOrder - b.sortOrder);

export const mockGetPointEntries = async (): Promise<PointEntry[]> =>
  [...pointsEntries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

export const mockGetSettings = async (): Promise<ScoreConfig> => ({ ...settings });

export const mockGetCurrentTerm = async (): Promise<Term | null> => currentTerm();

export const mockGetTerms = async (): Promise<Term[]> => [...terms];

export const mockGetMeetings = async (): Promise<MeetingRow[]> =>
  [...meetings].sort((a, b) => (a.heldOn < b.heldOn ? 1 : -1));

export const mockGetAttendanceForMeeting = async (meetingId: string): Promise<Record<string, AttendanceState>> => {
  const out: Record<string, AttendanceState> = {};
  attendance.filter((a) => a.meetingId === meetingId).forEach((a) => { out[a.memberId] = a.state; });
  return out;
};

export const mockGetAllAttendance = async (): Promise<Record<string, AttendanceState[]>> => {
  const out: Record<string, AttendanceState[]> = {};
  attendance.forEach((a) => { (out[a.memberId] ??= []).push(a.state); });
  return out;
};

export const mockGetTermStatuses = async (termId: string): Promise<MemberTermStatus[]> =>
  termStatuses.filter((s) => s.termId === termId).map((s) => ({ memberId: s.memberId, kind: s.kind, reason: s.reason }));

/* ─────────────────────────── Writes ─────────────────────────── */

export const mockAddMember = async (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Name is required.');
  members.push({ id: randomUUID(), name: trimmed, photoUrl: null });
};

function assertUnderCap(memberId: string, itemId: string, termId: string) {
  const item = pointItems.find((i) => i.id === itemId);
  if (!item?.maxPerTerm) return;
  const count = pointsEntries.filter((e) => e.memberId === memberId && e.itemId === itemId && e.termId === termId).length;
  if (count >= item.maxPerTerm) throw new Error(`"${item.label}" is capped at ${item.maxPerTerm} per term.`);
}

export const mockLogPoints = async (memberId: string, itemId: string, points: number) => {
  const term = currentTerm();
  if (!term) throw new Error('No current term is set.');
  assertUnderCap(memberId, itemId, term.id);
  pointsEntries.push({
    id: randomUUID(), memberId, itemId, label: pointItems.find((i) => i.id === itemId)?.label ?? '(item)',
    points, loggedBy: 'Exec (mock)', termId: term.id, meetingId: null, createdAt: new Date().toISOString(),
  });
};

export const mockCreatePointItem = async (input: { label: string; points: number; kind: 'reward' | 'punishment'; discretionary: boolean }) => {
  const sortOrder = Math.max(0, ...pointItems.map((i) => i.sortOrder)) + 1;
  const id = randomUUID();
  pointItems.push({
    id, label: input.label.trim(), points: input.discretionary ? 0 : input.points, kind: input.kind,
    discretionary: input.discretionary, archived: false, sortOrder, maxPerTerm: null, autoTrigger: null,
  });
  return { id };
};

export interface MockPointItemPatch {
  label?: string; points?: number; kind?: 'reward' | 'punishment'; discretionary?: boolean;
  maxPerTerm?: number | null; autoTrigger?: AttendanceState | null;
}
export const mockUpdatePointItem = async (itemId: string, patch: MockPointItemPatch) => {
  const item = pointItems.find((i) => i.id === itemId);
  if (!item) throw new Error('Item not found.');
  Object.assign(item, patch);
};

export const mockArchivePointItem = async (itemId: string, archived: boolean) => {
  const item = pointItems.find((i) => i.id === itemId);
  if (!item) throw new Error('Item not found.');
  item.archived = archived;
};

export const mockUpdateSettings = async (patch: { floor?: number; ceiling?: number | null }) => {
  if (patch.floor !== undefined) settings.floor = patch.floor;
  if (patch.ceiling !== undefined) settings.ceiling = patch.ceiling;
};

export const mockStartNewTerm = async (label: string) => {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('Term label is required.');
  terms.forEach((t) => { t.isCurrent = false; });
  terms.push({ id: randomUUID(), label: trimmed, isCurrent: true });
};

export interface MockAttendanceInput {
  meetingId: string | null;
  title: string;
  heldOn: string;
  entries: { memberId: string; state: AttendanceState }[];
}
export const mockRecordAttendance = async (input: MockAttendanceInput): Promise<string> => {
  let meetingId: string;
  if (input.meetingId) {
    meetingId = input.meetingId;
  } else {
    const term = currentTerm();
    if (!term) throw new Error('No current term is set.');
    meetingId = randomUUID();
    meetings.push({ id: meetingId, title: input.title.trim() || 'Chapter meeting', heldOn: input.heldOn, termId: term.id });
  }
  attendance = attendance.filter((a) => a.meetingId !== meetingId);
  input.entries.forEach((e) => attendance.push({ meetingId, memberId: e.memberId, state: e.state }));

  // Auto-award, mirroring applyAutoAwards: clear this meeting's auto entries, re-derive.
  pointsEntries = pointsEntries.filter((e) => e.meetingId !== meetingId);
  const term = currentTerm();
  const autoItems = pointItems.filter((i) => !i.archived && i.autoTrigger);
  input.entries.forEach((e) => {
    autoItems.filter((it) => it.autoTrigger === e.state).forEach((it) => {
      pointsEntries.push({
        id: randomUUID(), memberId: e.memberId, itemId: it.id, label: it.label, points: it.points,
        loggedBy: 'Auto (attendance, mock)', termId: term?.id ?? null, meetingId, createdAt: new Date().toISOString(),
      });
    });
  });
  return meetingId;
};

export const mockSetTermStatus = async (memberId: string, kind: 'abroad' | 'excused', reason: string) => {
  const term = currentTerm();
  if (!term) throw new Error('No current term is set.');
  termStatuses = termStatuses.filter((s) => !(s.memberId === memberId && s.termId === term.id));
  termStatuses.push({ memberId, termId: term.id, kind, reason: reason.trim() || null });
};

export const mockClearTermStatus = async (memberId: string) => {
  const term = currentTerm();
  if (!term) return;
  termStatuses = termStatuses.filter((s) => !(s.memberId === memberId && s.termId === term.id));
};
