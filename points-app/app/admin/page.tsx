import { getMembers, getPointItems, getPointEntries, getSettings, getAllAttendance } from '@/lib/data';
import { memberPointTotal, weekChange, attendancePctFrom } from '@/lib/points';
import { logPointsForm, addMemberForm } from './actions';

export default async function AdminHome() {
  const [members, items, entries, settings, attendance] = await Promise.all([
    getMembers(), getPointItems(), getPointEntries(), getSettings(), getAllAttendance(),
  ]);
  const now = new Date();
  const loggable = items.filter((i) => !i.autoTrigger); // auto-owned items are attendance-only
  const standings = members
    .map((m) => ({
      ...m,
      total: memberPointTotal(entries, m.id, settings),
      week: weekChange(entries, m.id, now),
      attendancePct: attendancePctFrom(attendance[m.id] ?? []),
    }))
    .sort((a, b) => b.total - a.total);

  return (
    <>
      <h2>Log points</h2>
      <form action={logPointsForm} className="card row">
        <div>
          <label htmlFor="memberId">Member</label>
          <select id="memberId" name="memberId" required>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="itemId">Item</label>
          <select id="itemId" name="itemId" required>
            {loggable.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label} {i.discretionary ? '(exec sets value)' : `(${i.points > 0 ? '+' : ''}${i.points})`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="discretionaryPoints">Value (if discretionary)</label>
          <input id="discretionaryPoints" name="discretionaryPoints" type="number" min={0} defaultValue={0} style={{ width: 90 }} />
        </div>
        <button type="submit">Log</button>
      </form>

      <h2>Add member</h2>
      <form action={addMemberForm} className="card row">
        <input name="name" placeholder="Full name" required />
        <button type="submit">Add</button>
      </form>

      <h2>Standings</h2>
      <table>
        <thead><tr><th>Member</th><th>Total</th><th>This week</th><th>Attendance</th></tr></thead>
        <tbody>
          {standings.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td>{m.total}</td>
              <td>{m.week > 0 ? `+${m.week}` : m.week}</td>
              <td>{m.attendancePct}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Recent activity</h2>
      <table>
        <thead><tr><th>Member</th><th>Item</th><th>Points</th><th>By</th><th>When</th></tr></thead>
        <tbody>
          {entries.slice(0, 25).map((e) => (
            <tr key={e.id}>
              <td>{members.find((m) => m.id === e.memberId)?.name ?? '—'}</td>
              <td>{e.label}</td>
              <td>{e.points > 0 ? `+${e.points}` : e.points}</td>
              <td>{e.loggedBy}</td>
              <td>{new Date(e.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
