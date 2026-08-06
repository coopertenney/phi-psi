import { getMembers, getPointEntries, getSettings } from '@/lib/data';
import { memberPointTotal, weekChange, rewardPunishmentSplit, entriesFor } from '@/lib/points';

export default async function BoardPage({ searchParams }: { searchParams: { m?: string } }) {
  const [members, entries, settings] = await Promise.all([getMembers(), getPointEntries(), getSettings()]);
  const now = new Date();
  const standings = members
    .map((m) => ({ ...m, total: memberPointTotal(entries, m.id, settings), week: weekChange(entries, m.id, now) }))
    .sort((a, b) => b.total - a.total);

  const selected = members.find((m) => m.id === searchParams.m) ?? null;

  return (
    <main>
      <h1>Points &amp; Attendance</h1>
      <p className="sub">Leaderboard — read only.</p>

      <table>
        <thead><tr><th>#</th><th>Member</th><th>Total</th><th>This week</th></tr></thead>
        <tbody>
          {standings.map((m, i) => (
            <tr key={m.id} className={m.id === selected?.id ? 'me' : ''}>
              <td>{i + 1}</td>
              <td><a className="link" href={`/board?m=${m.id}`}>{m.name}</a></td>
              <td>{m.total}</td>
              <td>{m.week > 0 ? `+${m.week}` : m.week}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected && (() => {
        const mine = entriesFor(entries, selected.id);
        const split = rewardPunishmentSplit(entries, selected.id);
        const total = memberPointTotal(entries, selected.id, settings);
        return (
          <>
            <h2>{selected.name}</h2>
            <p>
              Total <strong>{total}</strong>
              {' · '}Rewards <strong>+{split.reward}</strong>
              {' · '}Punishments <strong>{split.punishment}</strong>
            </p>
            <table>
              <thead><tr><th>Item</th><th>Points</th><th>When</th></tr></thead>
              <tbody>
                {mine.map((e) => (
                  <tr key={e.id}>
                    <td>{e.label}</td>
                    <td>{e.points > 0 ? `+${e.points}` : e.points}</td>
                    <td>{new Date(e.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
                {!mine.length && <tr><td className="muted">No entries yet.</td></tr>}
              </tbody>
            </table>
          </>
        );
      })()}
    </main>
  );
}
