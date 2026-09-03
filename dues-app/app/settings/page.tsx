import { Nav } from '@/components/Nav';
import { RosterImport } from '@/components/RosterImport';
import { db, isMockBackend } from '@/lib/db';
import { buildLedger } from '@/lib/ledger';
import { formatCents } from '@/lib/money';
import {
  applyAidAction, clearAbroadAction, clearAidAction, createTermAction, grantOppFundAction,
  issueChargesAction, markAbroadAction, matchAidNamesAction, previewAidNames,
  removeAdjustmentAction, setDuesAction, undoPaymentAction,
} from './actions';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { error?: string; ok?: string; aid?: string };
}) {
  const snap = await db.getSnapshot();
  const rows = buildLedger(snap);
  const term = snap.term;
  const chargedCount = new Set(
    snap.charges.filter((c) => !term || c.termId === term.id).map((c) => c.memberId),
  ).size;
  const memberName = (id: string) => snap.members.find((m) => m.id === id)?.name ?? 'unknown';
  // Grants belong to a term — an opportunity fund grant against Fall does not
  // reduce what a brother owes for Spring — so the list has to say which.
  const termLabel = (id: string) => snap.terms.find((t) => t.id === id)?.label ?? 'unknown term';
  const applied = [...snap.payments].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 25);
  const txnById = new Map(snap.txns.map((t) => [t.id, t]));
  const onAid = rows.filter((r) => r.financialAid);
  // Only present when the exec has pasted a list and is looking at the matches.
  const aidPreview = searchParams.aid ? await previewAidNames(searchParams.aid) : null;
  const abroad = rows.filter((r) => r.exempt);

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
          <h2>The roster</h2>
          <span className="hint">{snap.members.length} brothers</span>
        </div>
        <div className="panel">
          <h3>Add a pledge class</h3>
          <p className="note">
            Additive. Everyone already on the roster is left exactly as they are, and nobody
            is ever removed by this — so a wrong file here costs you a few names to delete,
            nothing more.
          </p>
          <RosterImport mode="pledges" members={snap.members} />
        </div>
        <div className="panel">
          <h3>Replace the whole roster</h3>
          <p className="note">
            For the start of a year. The file becomes the roster: brothers on it keep their
            payment history and every learned sender name, brothers missing from it are
            deleted along with their records. You will see exactly who would go before
            anything happens.
          </p>
          <RosterImport mode="replace" members={snap.members} />
        </div>
      </section>

      <section className="sec">
        <div className="sec-head">
          <h2>Start a new term</h2>
          <span className="hint">quarterly, or however often dues are collected</span>
        </div>
        <div className="panel">
          <form action={createTermAction} className="formrow">
            <label style={{ flex: '1 1 200px' }}>
              Term name
              <input name="label" type="text" required placeholder="Winter 2027" />
            </label>
            <label>
              Dues per brother
              <input name="dues" type="text" inputMode="decimal" placeholder="537" />
            </label>
            <label>
              First day of the term
              <input name="startsOn" type="date" />
            </label>
            <button className="btn-primary" type="submit">Start the term</button>
          </form>
          <p className="note">
            The new term becomes the current one and gets its own charges at its own price.
            Nothing is deleted &mdash; {term ? `${term.label}'s` : 'the old term\u2019s'} ledger
            stays exactly as it is, <strong>including what anyone still owes on it</strong>: a
            brother who never paid last term keeps owing it, and the next payment he sends settles
            that oldest unpaid term first before any of it reaches this one. The bank connection,
            the learned name matches and the financial aid list all carry over; they belong to the
            chapter, not to a term.
            The start date is used once, to tell the bank connection how far back to read &mdash;
            and to order the terms, which is what decides which one a payment settles first.
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="sec-head">
          <h2>Abroad this term</h2>
          <span className="hint">
            {abroad.length ? `${abroad.length} not being charged` : 'nobody is abroad this term'}
          </span>
        </div>
        <div className="panel">
          <form action={markAbroadAction} className="formrow">
            <label style={{ flex: '1 1 240px' }}>
              Brother
              <select name="memberId" required defaultValue="">
                <option value="" disabled>Pick a brother</option>
                {rows.filter((r) => !r.exempt).map((r) => (
                  <option key={r.memberId} value={r.memberId}>{r.name}</option>
                ))}
              </select>
            </label>
            <label style={{ flex: '1 1 200px' }}>
              Where
              <input name="reason" type="text" placeholder="Madrid, winter quarter" />
            </label>
            <button className="btn-primary" type="submit">Mark abroad</button>
          </form>
          <p className="note">
            He isn&rsquo;t charged for {term ? term.label : 'this term'} at all, so he owes nothing
            and never turns up on a follow-up list. This is per term &mdash; next quarter he is
            billed normally unless you mark him again. If he was already charged, that charge is
            removed; if a payment has already been applied to it, undo the payment first.
          </p>
        </div>

        {abroad.length > 0 && (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Brother</th><th>Where</th><th /></tr></thead>
              <tbody>
                {abroad.map((r) => {
                  const note = snap.exemptions.find(
                    (e) => e.memberId === r.memberId && (!term || e.termId === term.id),
                  );
                  return (
                    <tr key={r.memberId}>
                      <td className="who">{r.name}</td>
                      <td>{note?.reason || '—'}</td>
                      <td>
                        <form action={clearAbroadAction}>
                          <input type="hidden" name="memberId" value={r.memberId} />
                          <button className="btn-quiet" type="submit">Back this term</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="sec">
        <div className="sec-head">
          <h2>Financial aid</h2>
          <span className="hint">
            {onAid.length ? `${onAid.length} on the list` : 'nobody on the list yet'}
          </span>
        </div>
        <div className="panel">
          <p className="note">
            Marks a brother so nobody chases him for payment. It does <strong>not</strong> change
            what he is charged or what he owes &mdash; the chapter still knows the money is
            outstanding. To actually cover someone&rsquo;s dues, use an opportunity fund grant
            below.
          </p>
          {!aidPreview && (
            <form action={matchAidNamesAction} className="stack">
              <label>
                Paste the list &mdash; one name per line
                <textarea
                  name="names"
                  rows={6}
                  placeholder={'Bobby Chen\nJohnstone, Graham\nSam Shors'}
                  style={{
                    fontFamily: 'var(--f-mono)', fontSize: 13, padding: '8px 10px',
                    border: '1px solid var(--rule-2)', borderRadius: 2,
                    background: 'var(--surface)', color: 'var(--ink)', resize: 'vertical',
                  }}
                />
              </label>
              <div className="row">
                <button className="btn-primary" type="submit">Match these names</button>
                <span className="note" style={{ margin: 0 }}>
                  Copies straight out of a spreadsheet column. Nothing is saved until you confirm.
                </span>
              </div>
            </form>
          )}

          {aidPreview && (
            <form action={applyAidAction} className="stack">
              {aidPreview.matched.length > 0 && (
                <>
                  <h3>Found on the roster</h3>
                  <div className="applied">
                    {aidPreview.matched.map((m) => (
                      <label className="item" key={m.member.id} style={{ cursor: 'pointer' }}>
                        <input type="checkbox" name="memberId" value={m.member.id} defaultChecked />
                        <span className="who">{m.member.name}</span>
                        <span className="why">
                          from &ldquo;{m.line}&rdquo;
                          {m.score < 1 && <span className="mono"> · {m.score.toFixed(2)}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {aidPreview.ambiguous.length > 0 && (
                <>
                  <h3>More than one brother fits</h3>
                  <p className="note">Tick whichever is right, or leave them all unticked.</p>
                  <div className="applied">
                    {aidPreview.ambiguous.map((a) => (
                      <div className="item" key={a.line}>
                        <span className="who">&ldquo;{a.line}&rdquo;</span>
                        <span className="why">
                          {a.candidates.map((c) => (
                            <label key={c.id} style={{ marginRight: 14, display: 'inline-flex', gap: 5 }}>
                              <input type="checkbox" name="memberId" value={c.id} /> {c.name}
                            </label>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {aidPreview.unmatched.length > 0 && (
                <>
                  <h3>Nobody on the roster matched</h3>
                  <p className="note">
                    Fix the spelling and paste again, or add them to the roster first.
                  </p>
                  <div className="learned">
                    {aidPreview.unmatched.map((u) => (
                      <span className="alias" key={u}><span className="from">{u}</span></span>
                    ))}
                  </div>
                </>
              )}

              <div className="row">
                <button className="btn-primary" type="submit">Mark the ticked brothers</button>
                <a className="btn" href="/settings">Start over</a>
              </div>
            </form>
          )}
        </div>

        {onAid.length > 0 && (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Brother</th><th className="num">Owes</th><th /></tr>
              </thead>
              <tbody>
                {onAid.map((r) => (
                  <tr key={r.memberId}>
                    <td className="who">{r.name}</td>
                    <td className="num">{formatCents(r.balanceCents)}</td>
                    <td>
                      <form action={clearAidAction}>
                        <input type="hidden" name="memberId" value={r.memberId} />
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
                <tr>
                  <th>Brother</th><th>Term</th><th className="num">Covered</th><th>Note</th><th />
                </tr>
              </thead>
              <tbody>
                {snap.adjustments.map((a) => (
                  <tr key={a.id}>
                    <td className="who">{memberName(a.memberId)}</td>
                    <td>{termLabel(a.termId)}</td>
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
