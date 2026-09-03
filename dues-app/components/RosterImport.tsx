'use client';

import { useState } from 'react';
import { importRosterAction } from '@/app/settings/actions';
import { buildRosterPlan, readRosterCsv, type RosterCsvRow } from '@/lib/roster-csv';
import type { MemberRow } from '@/lib/types';

// The file is read and planned here so the exec sees what a replace costs before
// it happens. The server re-reads the same text and recomputes the plan against
// its own roster — nothing computed in the browser is trusted.

const MAX_BYTES = 1_000_000;

export function RosterImport(
  { mode, members }: { mode: 'replace' | 'pledges'; members: MemberRow[] },
) {
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ReturnType<typeof buildRosterPlan> | null>(null);
  const [skipped, setSkipped] = useState<{ line: number; reason: string }[]>([]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    setError(null);
    setPlan(null);
    setCsv('');
    if (!picked) return;
    if (picked.size > MAX_BYTES) { setError('That file is unexpectedly large for a roster.'); return; }
    try {
      const text = await picked.text();
      const read = readRosterCsv(text);
      setCsv(text);
      setFilename(picked.name);
      setSkipped(read.skipped);
      setPlan(buildRosterPlan(read.rows, members, mode));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be read.');
    }
  }

  const fuzzy = plan?.kept.filter((k) => k.score < 1) ?? [];

  return (
    <form action={importRosterAction} className="stack">
      <input type="hidden" name="csv" value={csv} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="filename" value={filename} />

      <label className="mapfield">
        {mode === 'replace' ? 'The new roster (.csv)' : 'The pledge class (.csv)'}
        <input type="file" accept=".csv,text/csv,text/plain" onChange={onPick} />
        <span className="maphint">
          A <code>name</code> column, and optionally <code>financial_aid</code> with yes or no.
          A single column of names with no header works too.
        </span>
      </label>

      {error && <p className="err">{error}</p>}

      {plan && (
        <>
          <ul className="tally">
            <li><b>{plan.kept.length}</b><span>already here — history kept</span></li>
            <li><b>{plan.added.length}</b><span>{mode === 'replace' ? 'new to the roster' : 'joining'}</span></li>
            {mode === 'replace' && (
              <li className={plan.removed.length ? '' : 'drop'}>
                <b>{plan.removed.length}</b><span>removed, with their records</span>
              </li>
            )}
            <li className="drop"><b>{plan.aidChanges.length}</b><span>financial aid changes</span></li>
          </ul>

          {fuzzy.length > 0 && (
            <>
              <h3>Spelled differently on the file</h3>
              <p className="note">
                These were matched to brothers already here, so their payments and learned
                sender names stay attached. If any pairing is wrong, fix the name in the file
                and pick it again.
              </p>
              <div className="learned">
                {fuzzy.map((k) => (
                  <span className="alias" key={k.member.id}>
                    <span className="from">{k.row.name}</span>
                    <span className="arw">is</span>
                    <span className="to">{k.member.name}</span>
                  </span>
                ))}
              </div>
            </>
          )}

          {mode === 'replace' && plan.removed.length > 0 && (
            <>
              <h3>These {plan.removed.length} will be deleted</h3>
              <p className="err">
                Deleting a brother deletes his payments and charges too. The amount the chapter
                shows as collected in past terms will drop by whatever these brothers had paid.
                This cannot be undone from the app.
              </p>
              <div className="learned">
                {plan.removed.slice(0, 40).map((m) => (
                  <span className="alias" key={m.id}><span className="from">{m.name}</span></span>
                ))}
                {plan.removed.length > 40 && (
                  <span className="alias"><span className="from">and {plan.removed.length - 40} more</span></span>
                )}
              </div>
            </>
          )}

          {skipped.length > 0 && (
            <p className="note">
              {skipped.length} row{skipped.length === 1 ? '' : 's'} skipped —
              {' '}line {skipped[0].line}: {skipped[0].reason}
              {skipped.length > 1 ? `, and ${skipped.length - 1} more` : ''}.
            </p>
          )}

          <button
            className={mode === 'replace' && plan.removed.length ? 'btn-danger' : 'btn-primary'}
            type="submit"
          >
            {mode === 'replace'
              ? `Replace the roster${plan.removed.length ? ` and delete ${plan.removed.length}` : ''}`
              : `Add ${plan.added.length} to the roster`}
          </button>
        </>
      )}
    </form>
  );
}
