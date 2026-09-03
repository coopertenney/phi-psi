import { db } from '@/lib/db';
import { formatCents } from '@/lib/money';

// The member-facing page: no login, no bank descriptors, no exec controls.

const STATUS_LABEL: Record<string, string> = {
  paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid', unbilled: 'Not charged',
  exempt: 'Abroad',
};

export default async function BalancesPage() {
  const rows = await db.getPublicLedger();
  const owing = rows.filter((r) => r.balanceCents > 0).length;

  return (
    <div className="wrap">
      <header className="masthead">
        <div className="eyebrow">Phi Kappa Psi · Cal Beta</div>
        <h1>What do I owe?</h1>
        <p>
          Every term you&rsquo;ve been charged for against everything that&rsquo;s been received —
          not just this quarter, so dues you never paid last quarter are still here. A payment
          settles your oldest unpaid term first and spills into the next one if it&rsquo;s big
          enough. Payments show up once an exec has matched them to you: a Zelle credit carries
          only a name and an amount, so matching is a human decision, not an instant one.
        </p>
      </header>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Brother</th><th className="num">Owed</th><th className="num">Paid</th>
              <th className="num">Balance</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.memberId} className={r.status === 'paid' ? 'settled' : undefined}>
                <td className="who">{r.name}</td>
                <td className="num">{formatCents(r.owedCents)}</td>
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

      <footer>
        <p>
          {owing} {owing === 1 ? 'brother' : 'brothers'} still owe. If you paid and it isn&rsquo;t
          showing, tell the treasurer the name your bank sends the payment under — that&rsquo;s
          usually the whole problem, and confirming it once fixes it for good.
        </p>
      </footer>
    </div>
  );
}
