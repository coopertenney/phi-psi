'use client';

import { useState } from 'react';
import type { LedgerRow, QueueItem } from '@/lib/types';
import { formatCents } from '@/lib/money';
import { applyCreditAction, confirmMatchAction, reverseAction, setAsideAction } from '@/app/actions';

const TIER_LABEL: Record<QueueItem['tier'], string> = {
  clear: 'Confident',
  check: 'Check this',
  unclear: 'Unclear',
  return: 'Returned',
};

function firstName(name: string) {
  return name.split(' ')[0];
}

function postedLabel(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `${month} ${d}`;
}

export function QueueCard({
  item,
  rows,
  duesCents,
}: {
  item: QueueItem;
  rows: LedgerRow[];
  duesCents: number | null;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { txn, tier, candidates, reason } = item;
  const top = candidates[0] ?? null;
  const amount = txn.amountCents;
  const abs = Math.abs(amount);

  // A split only makes sense when there is a term charge to divide by — and it
  // is the charge the amount actually divided into, which with Fall at $537 and
  // Spring at $300 is not always the current term's.
  const share = item.splitShareCents ?? duesCents;
  const canSplit = item.split && share !== null && share > 0;
  const firstShare = canSplit ? share! : abs;

  // "Owes" is now everything across every open term. Naming the oldest one too
  // matters at the moment of choosing: this is the picker where an exec decides
  // whose money it is, and the app is about to put it on that term.
  const options = rows.map((r) => {
    const oldest = r.terms.find((t) => t.termId === r.oldestUnpaidTermId);
    const spread = oldest && r.balanceCents > oldest.balanceCents
      ? ` (${formatCents(oldest.balanceCents)} of it ${oldest.termLabel})`
      : '';
    return (
      <option key={r.memberId} value={r.memberId}>
        {r.name} — owes {formatCents(Math.max(0, r.balanceCents))}{spread}
      </option>
    );
  });

  let who: JSX.Element;
  if (tier === 'return' && top) {
    who = <span className="who">Reverse {top.memberName}&rsquo;s payment</span>;
  } else if (item.tied) {
    who = <span className="who none">Two brothers fit — pick one</span>;
  } else if (!top) {
    who = <span className="who none">No match on the roster</span>;
  } else if (canSplit) {
    who = <span className="who">{top.memberName} &nbsp;+&nbsp; one other</span>;
  } else {
    who = <span className="who">{top.memberName}</span>;
  }

  const setAside = (
    <form action={setAsideAction} className="inline">
      <input type="hidden" name="txnId" value={txn.id} />
      <button className="btn-quiet" type="submit">{top ? 'Not dues' : 'Set aside'}</button>
    </form>
  );

  const openPicker = (label: string, className: string) => (
    <button className={className} type="button" onClick={() => setPickerOpen(true)}>{label}</button>
  );

  let acts: JSX.Element;
  if (tier === 'return') {
    acts = (
      <>
        <form action={reverseAction} className="inline">
          <input type="hidden" name="txnId" value={txn.id} />
          <input type="hidden" name="memberId" value={top?.memberId ?? ''} />
          <button className="btn-danger" type="submit" disabled={!top}>Reverse {formatCents(abs)}</button>
        </form>
        {openPicker('Someone else', 'btn')}
        {setAside}
      </>
    );
  } else if (item.tied) {
    acts = <>{openPicker('Choose brother', 'btn-primary')}{setAside}</>;
  } else if (!top) {
    acts = (
      <>
        {openPicker('Assign anyway', 'btn')}
        <form action={setAsideAction} className="inline">
          <input type="hidden" name="txnId" value={txn.id} />
          <button className="btn-primary" type="submit">Not dues</button>
        </form>
      </>
    );
  } else if (canSplit) {
    acts = (
      <>
        {openPicker(`Split ${formatCents(firstShare)} / ${formatCents(abs - firstShare)}`, 'btn-primary')}
        <form action={confirmMatchAction} className="inline">
          <input type="hidden" name="txnId" value={txn.id} />
          <input type="hidden" name="memberId" value={top.memberId} />
          <input type="hidden" name="amountCents" value={amount} />
          <input type="hidden" name="reason" value={reason} />
          <button className="btn" type="submit">All to {firstName(top.memberName)}</button>
        </form>
        {setAside}
      </>
    );
  } else {
    acts = (
      <>
        <form action={confirmMatchAction} className="inline">
          <input type="hidden" name="txnId" value={txn.id} />
          <input type="hidden" name="memberId" value={top.memberId} />
          <input type="hidden" name="amountCents" value={amount} />
          <input type="hidden" name="reason" value={reason} />
          <button className="btn-primary" type="submit">
            {item.partial ? `Apply ${formatCents(abs)} as partial` : 'Confirm'}
          </button>
        </form>
        {openPicker('Someone else', 'btn')}
        {setAside}
      </>
    );
  }

  const defaultA = top?.memberId ?? rows[0]?.memberId ?? '';
  const defaultB = candidates[1]?.memberId ?? rows.find((r) => r.memberId !== defaultA)?.memberId ?? '';

  return (
    <article className="card" data-state={tier}>
      <div className="side">
        <span className="lbl">What the bank sent</span>
        <code className="raw">{txn.rawDescription}</code>
        <div className="meta">
          <span className={`amt${amount < 0 ? ' neg' : ''}`}>{formatCents(amount)}</span>
          <span className="date">{postedLabel(txn.postedOn)}</span>
          {txn.pending && <span className="pending">Pending</span>}
        </div>
      </div>

      <div className="gutter" aria-hidden="true"><span>&rarr;</span></div>

      <div className="side">
        <span className="lbl">What the app thinks</span>
        <div className="guess">
          {who}
          <span className="why">{reason}</span>
        </div>
        <span className={`pill ${tier}`}><span className="dot" />{TIER_LABEL[tier]}</span>

        {/* Reassign / split picker. Whatever the exec chooses here is what gets
            learned, so the next credit from this sender matches on its own. */}
        <form
          action={tier === 'return' ? reverseAction : applyCreditAction}
          className={`reassign${pickerOpen ? ' open' : ''}`}
        >
          <input type="hidden" name="txnId" value={txn.id} />
          <input type="hidden" name="amountCents" value={amount} />
          <input type="hidden" name="firstShare" value={canSplit ? firstShare : amount} />
          <input type="hidden" name="reason" value={reason} />
          <div className="row">
            <span className="cap">
              {tier === 'return'
                ? 'Whose payment came back'
                : canSplit ? `First ${formatCents(firstShare)} to` : `Apply ${formatCents(abs)} to`}
            </span>
            <select name={tier === 'return' ? 'memberId' : 'memberA'} defaultValue={defaultA}>
              {options}
            </select>
          </div>
          {canSplit && tier !== 'return' && (
            <div className="row">
              <span className="cap">Second {formatCents(abs - firstShare)} to</span>
              <select name="memberB" defaultValue={defaultB}>{options}</select>
            </div>
          )}
          <div className="row">
            <button className="btn-primary" type="submit">Apply</button>
            <button className="btn-quiet" type="button" onClick={() => setPickerOpen(false)}>Cancel</button>
          </div>
        </form>

        <div className="acts">{acts}</div>
      </div>
    </article>
  );
}
