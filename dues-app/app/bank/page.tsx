import { ConnectBank } from '@/components/ConnectBank';
import { Nav } from '@/components/Nav';
import { canCreateNewItem } from '@/lib/bank/config';
import { isBankLive } from '@/lib/bank/provider';
import { db, isMockBackend } from '@/lib/db';
import { buildLedger } from '@/lib/ledger';
import { chooseAccountAction, selectableAccounts, setAutoApplyAction, syncNowAction } from './actions';

export const maxDuration = 60;

const RUN_LABEL: Record<string, string> = {
  manual: 'By hand', cron: 'Daily', webhook: 'Bank notified us', first_connect: 'First sync',
};

const when = (iso: string | null) => (iso
  ? new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  : '—');

export default async function BankPage({
  searchParams,
}: {
  searchParams: { error?: string; ok?: string };
}) {
  const [snap, status] = await Promise.all([db.getSnapshot(), db.getBankStatus()]);
  // Only fetched when there is a choice to make — it costs a bank call.
  const accounts = status.connected && !status.accountSelected ? await selectableAccounts() : [];
  const term = snap.term;
  // The CURRENT term's charges. buildLedger's row-level chargedCents spans every
  // term now, and "somebody was charged in Fall 2026" says nothing about whether
  // this term is ready to start matching against.
  const charged = buildLedger(snap).filter((r) => (r.current?.chargedCents ?? 0) > 0).length;
  // Syncing before charges exist gives the matcher no balances to compare
  // against, so nothing reaches a confident tier and every reason string is
  // wrong. Nothing is unsafe about it — it is just useless, and it makes the
  // treasurer's first impression a queue of unclear rows.
  const ready = Boolean(term?.duesCents) && charged > 0;

  return (
    <div className="wrap">
      <header className="masthead">
        <div className="head-row">
          <div>
            <div className="eyebrow">
              Phi Kappa Psi · Cal Beta{term ? ` · ${term.label}` : ''}
            </div>
            <h1>The bank connection</h1>
          </div>
          <Nav active="/bank" showSignOut={!isMockBackend} />
        </div>
        <p>
          Payments are read straight from the chapter account once a day, and whenever you
          ask. Only money coming in is ever stored — the chapter&rsquo;s own spending is
          counted and discarded before it reaches the database.
        </p>
      </header>

      {searchParams.error && <p className="err">{searchParams.error}</p>}
      {searchParams.ok && <p className="ok">{searchParams.ok}</p>}
      {!isBankLive && (
        <p className="note">
          Running on the built-in practice feed — no bank is connected and no Plaid
          credentials are set. Checking for payments walks the three cases that matter:
          credits arriving, a pending payment settling, and the bank taking one back.
        </p>
      )}

      {status.needsReauth && (
        <p className="err">
          The bank needs you to sign in again. Payments stop arriving until you do.
          {status.lastError ? ` (${status.lastError})` : ''}
        </p>
      )}

      {!ready && (
        <p className="err">
          Set the term dues amount and charge the roster under{' '}
          <a href="/settings">Term &amp; charges</a> first — until then there are no
          balances to match payments against.
        </p>
      )}

      {ready && !status.connected && (
        canCreateNewItem || isMockBackend
          ? <ConnectBank mode="connect" defaultStart={term?.startsOn ?? null} />
          : (
            <div className="panel">
              <h3>Connecting is locked</h3>
              <p className="note">
                This app holds exactly one bank connection, and creating another
                permanently uses up one of ten that the chapter will ever have. Whoever
                deploys the app has to unlock it deliberately for the one connect.
              </p>
            </div>
          )
      )}

      {status.connected && (
        <>
          <section className="summary">
            <div className="tile">
              <span className="k">Bank</span>
              <span className="v" style={{ fontSize: 19 }}>{status.institutionName ?? 'Connected'}</span>
              <span className="n">
                {status.accountName ?? 'account not chosen'}
                {status.accountMask ? ` ••${status.accountMask}` : ''}
              </span>
            </div>
            <div className="tile">
              <span className="k">Last checked</span>
              <span className="v" style={{ fontSize: 19 }}>{when(status.lastSyncedAt)}</span>
              <span className="n">{status.lastSyncedAt ? 'and every morning' : 'never yet'}</span>
            </div>
            <div className="tile">
              <span className="k">Connected</span>
              <span className="v" style={{ fontSize: 19 }}>{when(status.connectedAt)}</span>
              <span className="n">re-authenticate yearly</span>
            </div>
            <div className={status.needsReauth ? 'tile attn' : 'tile'}>
              <span className="k">Status</span>
              <span className="v" style={{ fontSize: 19 }}>
                {status.needsReauth ? 'Needs sign-in' : 'Healthy'}
              </span>
              <span className="n">{status.accountSelected ? 'reading the dues account' : 'choose an account'}</span>
            </div>
          </section>

          {!status.accountSelected && (
            <div className="panel">
              <h3>Which account receives dues?</h3>
              <p className="note">
                This connection covers more than one account. Nothing is read until you say which
                one &mdash; money moved between the chapter&rsquo;s own accounts arrives looking
                exactly like a payment from a brother, and would be matched as one.
              </p>
              <form action={chooseAccountAction} className="formrow">
                <label style={{ flex: '1 1 260px' }}>
                  Account
                  <select name="accountId" required defaultValue="">
                    <option value="" disabled>Pick an account</option>
                    {accounts.map((a) => (
                      <option key={a.accountId} value={a.accountId}>
                        {a.name}{a.mask ? ` ••${a.mask}` : ''}{a.subtype ? ` — ${a.subtype}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn-primary" type="submit">Use this account</button>
              </form>
            </div>
          )}

          <div className="panel">
            <h3>Check for new payments</h3>
            <p className="note">
              Runs automatically each morning. This is the same check, on demand — useful
              the day after dues are due.
            </p>
            <form action={syncNowAction}>
              <button className="btn-primary" type="submit">Check for new payments</button>
            </form>
          </div>

          <div className="panel">
            <h3>Applying the obvious ones</h3>
            <form action={setAutoApplyAction} className="formrow">
              <label className="checkline">
                <input type="checkbox" name="autoApply" defaultChecked={term?.autoApply ?? true} />
                <span>
                  When a payment can only be one brother <em>and</em> the amount is exactly
                  what he still owes, record it without asking. Everything less certain
                  waits for you, and anything recorded this way shows what matched and undoes
                  in one click.
                </span>
              </label>
              <button className="btn" type="submit">Save</button>
            </form>
            <p className="note">
              Saved per term, because the daily check runs with nobody watching.
            </p>
          </div>

          {status.connected && !isMockBackend && <ConnectBank mode="reconnect" />}
        </>
      )}

      {status.runs.length > 0 && (
        <section className="sec">
          <div className="sec-head">
            <h2>Recent checks</h2>
            <span className="hint">what each one found</span>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>When</th><th>Kind</th>
                  <th className="num">New</th><th className="num">Settled</th>
                  <th className="num">Applied</th><th className="num">Reversed</th>
                  <th className="num">Ignored</th><th>Result</th>
                </tr>
              </thead>
              <tbody>
                {status.runs.map((r) => (
                  <tr key={r.id}>
                    <td>{when(r.startedAt)}</td>
                    <td>{RUN_LABEL[r.trigger] ?? r.trigger}</td>
                    <td className="num">{r.addedCount || '—'}</td>
                    <td className="num">{r.settledCount || '—'}</td>
                    <td className="num">{r.autoAppliedCount || '—'}</td>
                    <td className="num">{r.reversedCount || '—'}</td>
                    <td className="num">{r.droppedDebitCount || '—'}</td>
                    <td>{r.error ? <span className="err">{r.error}</span> : r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
