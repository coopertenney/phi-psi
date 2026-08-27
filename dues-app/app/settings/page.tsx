import { Nav } from '@/components/Nav';
import { db, isMockBackend } from '@/lib/db';
import { buildLedger } from '@/lib/ledger';
import { formatCents } from '@/lib/money';
import {
  grantOppFundAction, issueChargesAction, removeAdjustmentAction, setDuesAction, undoPaymentAction,
} from './actions';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { error?: string; ok?: string };
}) {
  const snap = await db.getSnapshot();
  const rows = buildLedger(snap);
  const term = snap.term;
  const chargedCount = new Set(
    snap.charges.filter((c) => !term || c.termId === term.id).map((c) => c.memberId),
  ).size;
  const memberName = (id: string) => snap.members.find((m) => m.id === id)?.name ?? 'unknown';
  const applied = [...snap.payments].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 25);
  const txnById = new Map(snap.txns.map((t) => [t.id, t]));

  return (
    <div className="wrap">
      <header className="masthead">
        <div className="head-row">
          <div>
            <div className="eyebrow">Phi Kappa Psi · Cal Beta{term ? ` · ${term.label}` : ''}</div>
            <h1>Term &amp; charges</h1>
          </div>
          <Nav active="/settings" showSignOut={!isMockBackend} />
        </div>
        <p>
          What every brother owes this term, who the opportunity fund is covering, and the audit
          trail behind each applied payment.
        </p>
      </header>

      {searchParams.error && <p className="err">{searchParams.error}</p>}
      {searchParams.ok && <p className="ok">{searchParams.ok}</p>}

      <section className="sec">
        <div className="sec-head"><h2>Dues for the term</h2></div>
        <div className="panel">
          <form action={setDuesAction} className="formrow">
            <label>
              Amount per brother
              <input
                name="dues"
                type="text"
                inputMode="decimal"
                required
                defaultValue={term?.duesCents ? String(term.duesCents / 100) : ''}
                placeholder="450"
              />
            </label>
            <button className="btn-primary" type="submit">Save amount</button>
          </form>
          <form action={issueChargesAction}>
            <button className="btn" type="submit" disabled={!term?.duesCents}>
              Charge every brother who isn&rsquo;t charged yet
            </button>
          </form>
          <p className="note">
            {chargedCount} of {snap.members.length} brothers are charged this term
            {term?.duesCents ? ` at ${formatCents(term.duesCents)} each` : ''}. Charging is
            idempotent — running it again only bills whoever is missing, so it&rsquo;s safe after a
            new brother joins the roster.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="sec-head">
          <h2>Opportunity fund</h2>
          <span className="hint">covers dues for brothers on financial aid</span>
        </div>
        <div className="panel">
          <form action={grantOppFundAction} className="formrow">
            <label style={{ flex: '1 1 220px' }}>
              Brother
              <select name="memberId" required defaultValue="">
                <option value="" disabled>Pick a brother</option>
                {rows.map((r) => (
                  <option key={r.memberId} value={r.memberId}>
                    {r.name} — owes {formatCents(Math.max(0, r.balanceCents))}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount covered
              <input name="amount" type="text" inputMode="decimal" required placeholder="450" />
            </label>
            <label style={{ flex: '1 1 200px' }}>
              Note
              <input name="reason" type="text" placeholder="Full grant, Fall 2026" />
            </label>
            <button className="btn-primary" type="submit">Record grant</button>
          </form>
          <p className="note">
            A grant reduces what a brother owes without recording money that never arrived, so
            &ldquo;collected&rdquo; keeps meaning what actually hit the account.
          </p>
        </div>

        {snap.adjustments.length > 0 && (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Brother</th><th className="num">Covered</th><th>Note</th><th /></tr>
              </thead>
              <tbody>
                {snap.adjustments.map((a) => (
                  <tr key={a.id}>
                    <td className="who">{memberName(a.memberId)}</td>
                    <td className="num">{formatCents(a.amountCents)}</td>
                    <td>{a.reason || '—'}</td>
                    <td>
                      <form action={removeAdjustmentAction} className="inline">
                        <input type="hidden" name="adjustmentId" value={a.id} />
                        <button className="btn-quiet" type="submit">Remove</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="sec">
        <div className="sec-head">
          <h2>Applied payments</h2>
          <span className="count">{snap.payments.length} total</span>
          <span className="hint">why the app thinks each brother paid</span>
        </div>
        {applied.length ? (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Brother</th><th className="num">Amount</th><th>From the bank</th>
                  <th>Why</th><th />
                </tr>
              </thead>
              <tbody>
                {applied.map((p) => (
                  <tr key={p.id}>
                    <td className="who">{memberName(p.memberId)}</td>
                    <td className="num">{formatCents(p.amountCents)}</td>
                    <td className="mono">{txnById.get(p.bankTxnId)?.rawDescription ?? 'seeded'}</td>
                    <td style={{ fontSize: 13 }}>{p.reason || '—'}</td>
                    <td>
                      <form action={undoPaymentAction} className="inline">
                        <input type="hidden" name="paymentId" value={p.id} />
                        <button className="btn-quiet" type="submit">Undo</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">No payments applied yet.</div>
        )}
      </section>
    </div>
  );
}
