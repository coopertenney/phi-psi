import { getMembers, getMeetings, getAttendanceForMeeting, getCurrentTerm, getTermStatuses } from '@/lib/data';
import { createMeetingForm, recordAttendanceForm, setTermStatusForm } from './actions';
import type { AttendanceState } from '@/lib/types';

const STATES: AttendanceState[] = ['present', 'late', 'absent', 'excused', 'abroad'];

export default async function AttendancePage({ searchParams }: { searchParams: { meeting?: string } }) {
  const [members, meetings, term] = await Promise.all([getMembers(), getMeetings(), getCurrentTerm()]);
  const selected = meetings.find((m) => m.id === searchParams.meeting) ?? meetings[0] ?? null;
  const [existing, statuses] = await Promise.all([
    selected ? getAttendanceForMeeting(selected.id) : Promise.resolve({} as Record<string, AttendanceState>),
    term ? getTermStatuses(term.id) : Promise.resolve([]),
  ]);
  const statusByMember = Object.fromEntries(statuses.map((s) => [s.memberId, s]));

  return (
    <>
      <h2>New meeting</h2>
      <form action={createMeetingForm} className="card row">
        <input name="title" placeholder="Meeting title" defaultValue="Chapter meeting" required />
        <input name="heldOn" type="date" required />
        <button type="submit">Create</button>
      </form>

      <h2>Meetings</h2>
      <table>
        <tbody>
          {meetings.map((m) => (
            <tr key={m.id} className={m.id === selected?.id ? 'me' : ''}>
              <td><a className="link" href={`/admin/attendance?meeting=${m.id}`}>{m.title}</a></td>
              <td>{m.heldOn}</td>
            </tr>
          ))}
          {!meetings.length && <tr><td className="muted">No meetings yet.</td></tr>}
        </tbody>
      </table>

      {selected && (
        <>
          <h2>Take attendance — {selected.title} ({selected.heldOn})</h2>
          <form action={recordAttendanceForm}>
            <input type="hidden" name="meetingId" value={selected.id} />
            <input type="hidden" name="memberIds" value={members.map((m) => m.id).join(',')} />
            <table>
              <thead><tr><th>Member</th><th>State</th><th>Standing status</th></tr></thead>
              <tbody>
                {members.map((m) => {
                  const status = statusByMember[m.id];
                  const fallback: AttendanceState = status?.kind === 'abroad' ? 'abroad' : status?.kind === 'excused' ? 'excused' : 'present';
                  const current = existing[m.id] ?? fallback;
                  return (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>
                        <select name={`state-${m.id}`} defaultValue={current}>
                          {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="muted">{status ? `${status.kind}${status.reason ? ` — ${status.reason}` : ''}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button type="submit">Save attendance</button>
          </form>
        </>
      )}

      <h2>Standing status (abroad / recurring excused)</h2>
      <p className="muted">Pre-fills the grid above each meeting for {term?.label ?? 'the current term'} — exec still confirms per meeting.</p>
      {members.map((m) => {
        const status = statusByMember[m.id];
        return (
          <form key={m.id} action={setTermStatusForm} className="row">
            <input type="hidden" name="memberId" value={m.id} />
            <span style={{ width: 140 }}>{m.name}</span>
            <select name="kind" defaultValue={status?.kind ?? ''}>
              <option value="">None</option>
              <option value="abroad">Abroad</option>
              <option value="excused">Recurring excused</option>
            </select>
            <input name="reason" placeholder="Reason (optional)" defaultValue={status?.reason ?? ''} />
            <button type="submit" className="secondary">Save</button>
          </form>
        );
      })}
    </>
  );
}
