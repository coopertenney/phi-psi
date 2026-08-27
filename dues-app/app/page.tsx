import { QueueCard } from '@/components/QueueCard';
import { Nav } from '@/components/Nav';
import { db, isMockBackend } from '@/lib/db';
import { buildDesk } from '@/lib/ledger';
import { formatCents } from '@/lib/money';
import { loadSampleAction, recordCreditAction } from './actions';


const STATUS_LABEL: Record<string, string> = {
  paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid', unbilled: 'Not charged',
};

export default async function DeskPage({
  searchParams,
}: {
  searchParams: { error?: string; ok?: string };
}) {
  const snap = await db.getSnapshot();
  const { rows, queue, summary } = buildDesk(snap);
  const duesCents = snap.term?.duesCents ?? null;
  const collectedPct = summary.chargedCents
    ? Math.round((summary.collectedCents / (summary.chargedCents - summary.oppFundCents || 1)) * 100)
    : 0;
  const stillOwe = rows.filter((r) => r.balanceCents > 0).length;
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
          <span className="n">{stillOwe} of {summary.memberCount} brothers still owe</span>
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

      <section className="sec">
        <div className="sec-head">
          <h2>Record a credit</h2>
          <span className="hint">phase one — typed from the bank app by hand</span>
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
