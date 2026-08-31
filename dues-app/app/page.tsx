import { QueueCard } from '@/components/QueueCard';
import { Nav } from '@/components/Nav';
import { db, isMockBackend } from '@/lib/db';
import { buildDesk } from '@/lib/ledger';
import { formatCents } from '@/lib/money';
import { loadSampleAction, recordCreditAction } from './actions';
import { syncNowAction } from './bank/actions';


const STATUS_LABEL: Record<string, string> = {
  paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid', unbilled: 'Not charged',
};

export const maxDuration = 60;

export default async function DeskPage({
  searchParams,
}: {
  searchParams: { error?: string; ok?: string };
}) {
  const [snap, bank] = await Promise.all([db.getSnapshot(), db.getBankStatus()]);
  const { rows, queue, summary } = buildDesk(snap);
  const memberName = (id: string) => snap.members.find((m) => m.id === id)?.name ?? 'unknown';
  // Everything the sync did without asking, surfaced where an exec will actually
  // see it. A reversal that happens at 7am, or a payment recorded automatically,
  // is not an audit trail if you have to go looking for it.
  const autoApplied = snap.payments
    .filter((p) => p.reason.startsWith('Auto-applied'))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 8);
  const bankRemoved = snap.txns.filter((t) => t.removedAt && t.amountCents < 0);
  const amountChanged = snap.txns.filter((t) => t.amountChangedAt);
  const duesCents = snap.term?.duesCents ?? null;
  const collectedPct = summary.chargedCents
    ? Math.round((summary.collectedCents / (summary.chargedCents - summary.oppFundCents || 1)) * 100)
    : 0;
  // Who to actually chase. Brothers on financial aid still owe and still count
  // in the outstanding total — they are just not the treasurer's problem to
  // pursue, so they are named rather than hidden.
  const stillOwe = summary.followUpCount;
  const learned = snap.aliases;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="wrap">
      <header className="masthead">
        <div className="head-row">
          <div>
            <div className="eyebrow">
              Phi Kappa Psi · Cal Beta{snap.term ? ` · ${snap.term.label}` : ''}
            </div>
            <h1>Dues Desk</h1>
          </div>
          <Nav active="/" showSignOut={!isMockBackend} />
        </div>
        <p>
          Bank credits arrive with a name and an amount — never a memo. Everything below is the
          app&rsquo;s guess at who paid, waiting on an exec to agree or correct it. Each correction is
          remembered, so the queue gets shorter every term.
        </p>
      </header>

      {searchParams.error && <p className="err">{searchParams.error}</p>}
      {searchParams.ok && <p className="ok">{searchParams.ok}</p>}

      <section className="summary" aria-live="polite">
        <div className="tile">
          <span className="k">Collected</span>
          <span className="v">{formatCents(summary.collectedCents)}</span>
          <span className="n">
            {summary.chargedCents ? `${collectedPct}% of ${formatCents(summary.chargedCents - summary.oppFundCents)}` : 'nothing charged yet'}
          </span>
        </div>
        <div className="tile">
          <span className="k">Outstanding</span>
          <span className="v">{formatCents(summary.outstandingCents)}</span>
          <span className="n">
            {stillOwe} to follow up
            {summary.aidCount ? ` · ${summary.aidCount} on financial aid` : ''}
          </span>
        </div>
        <div className="tile attn">
          <span className="k">Needs review</span>
          <span className="v">{summary.queueCount}</span>
          <span className="n">{summary.queueCount ? 'credits awaiting a decision' : 'queue is clear'}</span>
        </div>
        <div className="tile">
          <span className="k">Set aside</span>
          <span className="v">{summary.setAsideCount}</span>
          <span className="n">not dues</span>
        </div>
      </section>

      {!duesCents && (
        <p className="err">
          No dues amount is set for this term yet, so nothing is charged and the matcher has no
          amount to compare against. Set it under <a href="/settings">Term &amp; charges</a>.
        </p>
      )}

      {bank.needsReauth && (
        <p className="err">
          The bank needs you to sign in again, so no new payments are arriving.{' '}
          <a href="/bank">Reconnect it</a>.
        </p>
      )}

      {bankRemoved.length > 0 && (
        <section className="sec">
          <div className="sec-head">
            <h2>Taken back by the bank</h2>
            <span className="count">{bankRemoved.length}</span>
            <span className="hint">reversed automatically — the bank says these never happened</span>
          </div>
          <div className="applied">
            {bankRemoved.map((t) => (
              <div className="item" key={t.id}>
                <span className="amt-s">{formatCents(t.amountCents)}</span>
                <span className="why">
                  {t.rawDescription}
                  {' — '}
                  {snap.payments.filter((p) => p.bankTxnId === t.id)
                    .map((p) => `${memberName(p.memberId)} is back on the unpaid list`)
                    .join(', ') || 'nothing had been applied to it'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {amountChanged.length > 0 && (
        <p className="err">
          The bank changed the amount on {amountChanged.length} credit
          {amountChanged.length === 1 ? '' : 's'} after it was already applied. Undo the
          payment under <a href="/settings">Term &amp; charges</a> and re-apply it.
        </p>
      )}

      {autoApplied.length > 0 && (
        <section className="sec">
          <div className="sec-head">
            <h2>Applied without asking you</h2>
            <span className="count">{autoApplied.length}</span>
            <span className="hint">undo any of these under Term &amp; charges</span>
          </div>
          <div className="applied">
            {autoApplied.map((p) => (
              <div className="item" key={p.id}>
                <span className="who">{memberName(p.memberId)}</span>
                <span className="amt-s">{formatCents(p.amountCents)}</span>
                <span className="why">{p.reason}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="sec">
        <div className="sec-head">
          <h2>Check the bank</h2>
          <span className="hint">
            {bank.lastSyncedAt
              ? `last checked ${new Date(bank.lastSyncedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
              : 'not checked yet'}
          </span>
        </div>
        <form action={syncNowAction} className="panel">
          <div className="formrow">
            <button className="btn-primary" type="submit">Check for new payments</button>
            <span className="note" style={{ margin: 0 }}>
              Runs on its own each morning. Debits never reach the database.
            </span>
          </div>
        </form>
      </section>

      <section className="sec">
        <div className="sec-head">
          <h2>Record a credit by hand</h2>
          <span className="hint">the escape hatch — normally the bank check does this</span>
        </div>
        <form action={recordCreditAction} className="panel">
          <div className="formrow">
            <label style={{ flex: '2 1 320px' }}>
              Bank descriptor
              <input
                name="rawDescription"
                type="text"
                required
                placeholder="ZELLE PMT FROM ROBERT M SMITH JR"
              />
            </label>
            <label>
              Amount
              <input name="amount" type="text" required placeholder="450" inputMode="decimal" />
            </label>
            <label>
              Posted
              <input name="postedOn" type="date" required defaultValue={today} />
            </label>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <input name="pending" type="checkbox" /> Pending
            </label>
            <button className="btn-primary" type="submit">Add to queue</button>
          </div>
          <p className="note">
            Paste the descriptor exactly as the bank shows it — the prefix and name order are what
            the matcher reads. A returned payment goes in as a negative amount.
          </p>
        </form>
      </section>

      <section className="sec">
        <div className="sec-head">
          <h2>Review queue</h2>
          <span className="count">{queue.length ? `${queue.length} open` : '0 open'}</span>
          <span className="hint">the bank said → the app thinks</span>
        </div>
        {queue.length ? (
          <div className="cards">
            {queue.map((item) => (
              <QueueCard key={item.txn.id} item={item} rows={rows} duesCents={duesCents} />
            ))}
          </div>
        ) : (
          <div className="empty">
            Queue is clear. Every credit has been accounted for.
            {isMockBackend && (
              <form action={loadSampleAction} style={{ marginTop: 12 }}>
                <button className="btn" type="submit">Load the walkthrough credits</button>
              </form>
            )}
          </div>
        )}
      </section>

      <section className="sec">
        <div className="sec-head">
          <h2>Ledger</h2>
          <span className="count">{summary.settledCount} of {summary.memberCount} settled</span>
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Brother</th>
                <th className="num">Owed</th>
                <th className="num">Paid</th>
                <th className="num">Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.memberId} className={r.status === 'paid' ? 'settled' : undefined}>
                  <td className="who">
                    {r.name}
                    {r.aka.length > 0 && (
                      <span className="learned">also matches: {r.aka.join(' · ')}</span>
                    )}
                  </td>
                  <td className="num">
                    {formatCents(r.owedCents)}
                    {r.oppFundCents > 0 && (
                      <span className="learned">opp fund {formatCents(r.oppFundCents)}</span>
                    )}
                  </td>
                  <td className="num">{formatCents(r.paidCents)}</td>
                  <td className="num">{r.balanceCents <= 0 ? '—' : formatCents(r.balanceCents)}</td>
                  <td>
                    <span className={`tag ${r.status}`}>{STATUS_LABEL[r.status]}</span>
                    {r.financialAid && (
                      <span className="tag aid" title="Not chased for payment">Financial aid</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sec">
        <div className="sec-head">
          <h2>Learned name matches</h2>
          <span className="count">{learned.length ? `${learned.length} stored` : 'none yet'}</span>
          <span className="hint">confirmed once, matched automatically after</span>
        </div>
        {learned.length ? (
          <div className="alias-list">
            {learned.map((a) => (
              <div className="alias" key={a.id}>
                <span className="from">{a.bankName}</span>
                <span className="arw">&rarr;</span>
                <span className="to">{snap.members.find((m) => m.id === a.memberId)?.name ?? 'unknown'}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">
            Nothing learned yet. Confirm a payment whose bank name differs from the roster and the
            pairing is stored here.
          </div>
        )}
      </section>

      <footer>
        <p>
          <strong>Phase one.</strong> Credits are entered by hand; there is no bank connection yet.
          The Plaid feed replaces the hand entry later and these screens do not change.
          {isMockBackend && ' Running on the in-memory mock store — everything resets when the dev server restarts.'}
        </p>
        <p>
          <strong>Still open:</strong> Stanford FCU&rsquo;s exact Zelle descriptor. The prefix and name
          order vary by institution, so the parser needs one redacted real example before it can be
          trusted on live data.
        </p>
      </footer>
    </div>
  );
}
