import { getPointItems, getSettings, getCurrentTerm } from '@/lib/data';
import {
  createPointItemForm, updatePointItemForm, archivePointItemForm, updateSettingsForm, startNewTermForm,
} from './actions';

export default async function CatalogPage() {
  const [items, settings, term] = await Promise.all([getPointItems(true), getSettings(), getCurrentTerm()]);

  return (
    <>
      <h2>Scoring rules</h2>
      <form action={updateSettingsForm} className="card row">
        <div>
          <label htmlFor="floor">Floor</label>
          <input id="floor" name="floor" type="number" defaultValue={settings.floor} style={{ width: 80 }} />
        </div>
        <div>
          <label htmlFor="ceiling">Ceiling (blank = none)</label>
          <input id="ceiling" name="ceiling" type="number" defaultValue={settings.ceiling ?? ''} style={{ width: 80 }} />
        </div>
        <button type="submit">Save</button>
      </form>

      <h2>Term</h2>
      <p className="muted">Current: <strong>{term?.label ?? 'none'}</strong>. Used only to scope per-term caps below — starting a new term does not reset anyone's total.</p>
      <form action={startNewTermForm} className="card row">
        <input name="label" placeholder="e.g. Winter 2027" required />
        <button type="submit">Start new term</button>
      </form>

      <h2>Add catalog item</h2>
      <form action={createPointItemForm} className="card row">
        <input name="label" placeholder="Label" required style={{ flex: 1 }} />
        <input name="points" type="number" placeholder="Points" defaultValue={0} style={{ width: 80 }} />
        <select name="kind" defaultValue="reward">
          <option value="reward">Reward</option>
          <option value="punishment">Punishment</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input name="discretionary" type="checkbox" /> Discretionary
        </label>
        <button type="submit">Add</button>
      </form>

      <h2>Catalog</h2>
      {items.map((item) => (
        <div key={item.id} className="card">
          <form action={updatePointItemForm} className="row">
            <input type="hidden" name="itemId" value={item.id} />
            <input name="label" defaultValue={item.label} style={{ flex: 1 }} />
            <input name="points" type="number" defaultValue={item.points} style={{ width: 70 }} disabled={item.discretionary} />
            <select name="kind" defaultValue={item.kind}>
              <option value="reward">Reward</option>
              <option value="punishment">Punishment</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input name="discretionary" type="checkbox" defaultChecked={item.discretionary} /> Discretionary
            </label>
            <div>
              <label htmlFor={`cap-${item.id}`}>Max/term</label>
              <input id={`cap-${item.id}`} name="maxPerTerm" type="number" defaultValue={item.maxPerTerm ?? ''} style={{ width: 70 }} />
            </div>
            <div>
              <label htmlFor={`auto-${item.id}`}>Auto-award on</label>
              <select id={`auto-${item.id}`} name="autoTrigger" defaultValue={item.autoTrigger ?? ''}>
                <option value="">Manual only</option>
                <option value="present">Present</option>
                <option value="late">Late</option>
                <option value="absent">Absent</option>
                <option value="excused">Excused</option>
              </select>
            </div>
            <button type="submit">Save</button>
          </form>
          <form action={archivePointItemForm} style={{ marginTop: 8 }}>
            <input type="hidden" name="itemId" value={item.id} />
            <input type="hidden" name="archived" value={String(!item.archived)} />
            <span className={`pill ${item.kind}`}>{item.kind}</span>{' '}
            {item.autoTrigger && <span className="muted">auto-awarded on {item.autoTrigger} · hidden from Log points</span>}
            <button type="submit" className="secondary" style={{ marginLeft: 8 }}>
              {item.archived ? 'Restore' : 'Archive'}
            </button>
          </form>
        </div>
      ))}
    </>
  );
}
