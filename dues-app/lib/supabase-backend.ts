import { getServerSupabase } from './supabase/server';
import type {
  ApplyCreditInput, DuesBackend, FeedApplyResult, FeedPageInput, OppFundInput, RecordCreditInput,
} from './backend';
import type {
  Adjustment, BankStatus, BankTxn, DuesCharge, Exemption, LedgerStatus, MemberRow, NameAlias,
  PaymentRow, PublicBalance, Snapshot, SyncRunRow, Term,
} from './types';
import { getServiceSupabase, hasServiceRole } from './supabase/service';
import { isServiceContext } from './supabase/context';

// Inside a sync there is no exec session, and every RLS policy in schema.sql is
// `to authenticated` — so a session client reads zero rows and writes nothing,
// silently. Everywhere else this is the ordinary cookie-bound client.
function activeClient() {
  return isServiceContext() && hasServiceRole ? getServiceSupabase() : getServerSupabase();
}
import { aliasToLearn, normalizeName } from './match';
import { formatCents } from './money';

// The live backend. Reads the whole term in one round of parallel selects —
// ~105 members and a few hundred rows, so paging would cost more than it saves.

function fail(context: string, error: { message: string } | null) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

const toMember = (r: any): MemberRow => ({
  id: r.id, name: r.name, aka: r.aka ?? [], photoUrl: r.photo_url ?? null,
  financialAid: r.financial_aid ?? false,
});
const toTerm = (r: any): Term => ({
  id: r.id, label: r.label, startsOn: r.starts_on ?? null, isCurrent: r.is_current,
  duesCents: r.dues_cents ?? null, autoApply: r.auto_apply ?? true,
});
const toExemption = (r: any): Exemption => ({
  id: r.id, memberId: r.member_id, termId: r.term_id, reason: r.reason ?? '',
  createdBy: r.created_by ?? '', createdAt: r.created_at,
});
const toCharge = (r: any): DuesCharge => ({
  id: r.id, memberId: r.member_id, termId: r.term_id, amountCents: r.amount_cents,
  description: r.description ?? '',
});
const toTxn = (r: any): BankTxn => ({
  id: r.id, providerTxnId: r.provider_txn_id, pendingTxnId: r.pending_txn_id ?? null,
  accountId: r.account_id ?? null, postedOn: r.posted_on, amountCents: r.amount_cents,
  rawDescription: r.raw_description, pending: r.pending, removedAt: r.removed_at,
  amountChangedAt: r.amount_changed_at ?? null,
  source: r.source, status: r.status, enteredBy: r.entered_by ?? '',
});

const toRun = (r: any): SyncRunRow => ({
  id: r.id, trigger: r.trigger, startedAt: r.started_at, finishedAt: r.finished_at,
  addedCount: r.added_count, settledCount: r.settled_count, modifiedCount: r.modified_count,
  removedCount: r.removed_count, reversedCount: r.reversed_count,
  droppedDebitCount: r.dropped_debit_count, autoAppliedCount: r.auto_applied_count,
  status: r.status, error: r.error ?? null,
});
const toPayment = (r: any): PaymentRow => ({
  id: r.id, bankTxnId: r.bank_txn_id, memberId: r.member_id, termId: r.term_id,
  chargeId: r.charge_id,
  amountCents: r.amount_cents, appliedBy: r.applied_by ?? '', reason: r.reason ?? '',
  createdAt: r.created_at,
});
const toAdjustment = (r: any): Adjustment => ({
  id: r.id, memberId: r.member_id, termId: r.term_id, amountCents: r.amount_cents,
  kind: r.kind, reason: r.reason ?? '', createdBy: r.created_by ?? '', createdAt: r.created_at,
});
const toAlias = (r: any): NameAlias => ({
  id: r.id, bankName: r.bank_name, memberId: r.member_id, createdBy: r.created_by ?? '',
  createdAt: r.created_at,
});

async function actorEmail(): Promise<string> {
  if (isServiceContext()) return 'Bank sync';
  const sb = getServerSupabase();
  const { data } = await sb.auth.getUser();
  return data.user?.email ?? 'exec';
}

async function currentTerm(): Promise<Term> {
  const sb = activeClient();
  const { data, error } = await sb.from('terms').select('*').eq('is_current', true).maybeSingle();
  fail('read current term', error);
  if (!data) throw new Error('No current term is set.');
  return toTerm(data);
}

async function chargeIdFor(memberId: string, termId: string): Promise<string | null> {
  const sb = activeClient();
  const { data, error } = await sb.from('dues_charges')
    .select('id').eq('member_id', memberId).eq('term_id', termId).maybeSingle();
  fail('read charge', error);
  return data?.id ?? null;
}

export const supabaseBackend: DuesBackend = {
  async getSnapshot(): Promise<Snapshot> {
    const sb = activeClient();
    const [members, terms, charges, txns, payments, adjustments, exemptions, aliases, actor] = await Promise.all([
      sb.from('members').select('id, name, aka, photo_url').order('name'),
      sb.from('terms').select('*').order('created_at', { ascending: false }),
      sb.from('dues_charges').select('*'),
      sb.from('bank_txns').select('*').order('posted_on'),
      sb.from('payments').select('*').order('created_at'),
      sb.from('adjustments').select('*'),
      sb.from('exemptions').select('*'),
      sb.from('name_aliases').select('*').order('created_at', { ascending: false }),
      actorEmail(),
    ]);
    fail('read members', members.error);
    fail('read terms', terms.error);
    fail('read charges', charges.error);
    fail('read bank transactions', txns.error);
    fail('read payments', payments.error);
    fail('read adjustments', adjustments.error);
    fail('read exemptions', exemptions.error);
    fail('read name aliases', aliases.error);

    const allTerms = (terms.data ?? []).map(toTerm);
    return {
      members: (members.data ?? []).map(toMember),
      term: allTerms.find((t) => t.isCurrent) ?? null,
      terms: allTerms,
      charges: (charges.data ?? []).map(toCharge),
      txns: (txns.data ?? []).map(toTxn),
      payments: (payments.data ?? []).map(toPayment),
      adjustments: (adjustments.data ?? []).map(toAdjustment),
      exemptions: (exemptions.data ?? []).map(toExemption),
      aliases: (aliases.data ?? []).map(toAlias),
      actor,
    };
  },

  async getPublicLedger(): Promise<PublicBalance[]> {
    const sb = getServerSupabase();
    const { data, error } = await sb.from('member_balances').select('*').order('name');
    fail('read balances', error);
    return (data ?? []).map((r: any) => {
      const owedCents = r.owed_cents ?? 0;
      const paidCents = r.paid_cents ?? 0;
      const chargedCents = r.charged_cents ?? 0;
      const status: LedgerStatus = chargedCents === 0
        ? 'unbilled'
        : paidCents >= owedCents ? 'paid' : paidCents > 0 ? 'partial' : 'unpaid';
      return {
        memberId: r.member_id,
        name: r.name,
        owedCents,
        paidCents,
        balanceCents: r.balance_cents ?? 0,
        status,
      };
    });
  },

  async recordCredit(input: RecordCreditInput) {
    if (!input.rawDescription.trim()) throw new Error('The bank descriptor is required.');
    if (!input.amountCents) throw new Error('Amount must be a non-zero number.');
    const sb = getServerSupabase();
    const { error } = await sb.from('bank_txns').insert({
      posted_on: input.postedOn,
      amount_cents: input.amountCents,
      raw_description: input.rawDescription.trim(),
      pending: input.pending,
      source: 'manual',
      status: 'queued',
      entered_by: await actorEmail(),
    });
    fail('record credit', error);
  },

  async applyCredit(input: ApplyCreditInput) {
    // Reached from the sync's auto-apply as well as from an exec's click.
    const sb = activeClient();
    const term = await currentTerm();
    const actor = await actorEmail();

    const { data: txnRow, error: txnError } = await sb.from('bank_txns')
      .select('*').eq('id', input.txnId).maybeSingle();
    fail('read credit', txnError);
    if (!txnRow) throw new Error('That credit no longer exists.');
    const txn = toTxn(txnRow);

    const total = input.allocations.reduce((a, x) => a + x.amountCents, 0);
    if (!input.allocations.length) throw new Error('Pick at least one brother.');
    const ids = input.allocations.map((a) => a.memberId);
    if (new Set(ids).size !== ids.length) throw new Error('Pick two different brothers.');

    // The amount check has to be cumulative, not per-call. `applyCredit` is three
    // writes and only the payments insert is protected by a unique index: if the
    // status update fails, the credit stays queued and a second apply to a
    // DIFFERENT member would pass a per-call check and turn one $450 credit into
    // $900 of payments.
    const { data: existing, error: existingError } = await sb.from('payments')
      .select('amount_cents').eq('bank_txn_id', txn.id);
    fail('read payments', existingError);
    const alreadyApplied = (existing ?? []).reduce((a: number, p: any) => a + p.amount_cents, 0);
    if (alreadyApplied + total !== txn.amountCents) {
      throw new Error(alreadyApplied
        ? `${formatCents(alreadyApplied)} of this credit is already applied — the rest has to add up to ${formatCents(txn.amountCents - alreadyApplied)}.`
        : 'The split has to add up to the credit exactly.');
    }

    const rows = await Promise.all(input.allocations.map(async (a) => ({
      bank_txn_id: txn.id,
      member_id: a.memberId,
      term_id: term.id,
      charge_id: await chargeIdFor(a.memberId, term.id),
      amount_cents: a.amountCents,
      applied_by: actor,
      reason: input.reason,
    })));
    // unique (bank_txn_id, member_id) makes this insert the idempotency point:
    // a double-submit hits the constraint instead of double-crediting.
    const { error } = await sb.from('payments').insert(rows);
    fail('apply credit', error);

    if (input.learnAliasFor) {
      const member = (await sb.from('members').select('id, name, aka').eq('id', input.learnAliasFor).maybeSingle()).data;
      const bankName = member ? aliasToLearn(txn.rawDescription, member.name) : null;
      if (member && bankName) {
        // Duplicate alias just means it was already learned — not an error worth
        // failing an applied payment over.
        await sb.from('name_aliases').insert({
          bank_name: bankName,
          normalized: normalizeName(bankName),
          member_id: member.id,
          created_by: actor,
        });
        const aka: string[] = member.aka ?? [];
        if (!aka.some((a) => normalizeName(a) === normalizeName(bankName))) {
          await sb.from('members').update({ aka: [...aka, bankName] }).eq('id', member.id);
        }
      }
    }

    fail('close credit', (await sb.from('bank_txns').update({ status: 'applied' }).eq('id', txn.id)).error);
  },

  async setAside(txnId: string) {
    const sb = getServerSupabase();
    fail('set credit aside', (await sb.from('bank_txns').update({ status: 'set_aside' }).eq('id', txnId)).error);
  },

  async reverseCredit(txnId: string, memberId: string) {
    const sb = getServerSupabase();
    const term = await currentTerm();
    const { data, error } = await sb.from('bank_txns').select('*').eq('id', txnId).maybeSingle();
    fail('read credit', error);
    if (!data) throw new Error('That credit no longer exists.');
    const txn = toTxn(data);
    if (txn.amountCents >= 0) throw new Error('Only a negative credit reverses a payment.');

    const { error: payError } = await sb.from('payments').insert({
      bank_txn_id: txn.id,
      member_id: memberId,
      term_id: term.id,
      charge_id: await chargeIdFor(memberId, term.id),
      amount_cents: txn.amountCents,
      applied_by: await actorEmail(),
      reason: `Reversal of a returned credit (${txn.rawDescription}).`,
    });
    fail('reverse credit', payError);
    fail('close credit', (await sb.from('bank_txns').update({ status: 'applied' }).eq('id', txn.id)).error);
  },

  async undoPayment(paymentId: string) {
    const sb = getServerSupabase();
    const { data, error } = await sb.from('payments')
      .select('bank_txn_id, member_id').eq('id', paymentId).maybeSingle();
    fail('read payment', error);
    if (!data) throw new Error('That payment no longer exists.');

    const { data: txnRow, error: txnError } = await sb.from('bank_txns')
      .select('id, amount_cents, raw_description, removed_at').eq('id', data.bank_txn_id).maybeSingle();
    fail('read credit', txnError);
    // The bank already reversed this credit; the positive row is history. Undoing
    // it would leave only the negative and put the brother $450 further underwater.
    if (txnRow?.removed_at) {
      throw new Error('The bank took this credit back — its reversal is already recorded.');
    }

    fail('undo payment', (await sb.from('payments').delete().eq('id', paymentId)).error);

    // Unlearn what applying this credit taught, or undoing a wrong match leaves
    // the alias behind and every later credit from that sender matches the wrong
    // brother at full confidence.
    if (txnRow) {
      const { data: member } = await sb.from('members')
        .select('id, name, aka').eq('id', data.member_id).maybeSingle();
      const bankName = member ? aliasToLearn(txnRow.raw_description, member.name) : null;
      if (member && bankName) {
        await sb.from('name_aliases').delete()
          .eq('member_id', member.id).eq('normalized', normalizeName(bankName));
        const aka: string[] = member.aka ?? [];
        const kept = aka.filter((a) => normalizeName(a) !== normalizeName(bankName));
        if (kept.length !== aka.length) {
          await sb.from('members').update({ aka: kept }).eq('id', member.id);
        }
      }
    }

    // Requeue whenever the credit is no longer fully accounted for — not only
    // when the last payment is gone. Undoing one half of a split otherwise
    // strands the other half on no ledger and in no queue.
    const { data: siblings, error: sibError } = await sb.from('payments')
      .select('amount_cents').eq('bank_txn_id', data.bank_txn_id);
    fail('read payments', sibError);
    const applied = (siblings ?? []).reduce((a: number, p: any) => a + p.amount_cents, 0);
    if (!txnRow || applied !== txnRow.amount_cents) {
      fail('requeue credit', (await sb.from('bank_txns').update({ status: 'queued' }).eq('id', data.bank_txn_id)).error);
    }
  },

  async setTermDues(amountCents: number) {
    if (amountCents <= 0) throw new Error('Dues must be more than zero.');
    const sb = getServerSupabase();
    const term = await currentTerm();
    fail('set dues', (await sb.from('terms').update({ dues_cents: amountCents }).eq('id', term.id)).error);
  },

  async createTerm(label: string, duesCents: number | null, startsOn: string | null) {
    const trimmed = label.trim();
    if (!trimmed) throw new Error('Give the term a name, like "Winter 2027".');
    const sb = activeClient();

    const { data: existing, error: readError } = await sb.from('terms').select('id, label');
    fail('read terms', readError);
    if ((existing ?? []).some((t: any) => t.label.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`There is already a term called "${trimmed}".`);
    }

    // terms_one_current is a unique partial index, so the old current has to be
    // cleared BEFORE the new row goes in or the insert violates it.
    fail('close the current term',
      (await sb.from('terms').update({ is_current: false }).eq('is_current', true)).error);
    const { error } = await sb.from('terms')
      .insert({ label: trimmed, is_current: true, dues_cents: duesCents, starts_on: startsOn });
    fail('start the new term', error);
  },

  async setFinancialAid(memberIds: string[], enabled: boolean) {
    if (!memberIds.length) return;
    const sb = activeClient();
    fail('save financial aid',
      (await sb.from('members').update({ financial_aid: enabled }).in('id', memberIds)).error);
  },

  async setExempt(memberId: string, reason: string) {
    const sb = activeClient();
    const term = await currentTerm();

    // An exemption is the absence of a charge, not a waived one — so a charge
    // already issued comes off. Unless money has landed against it, in which
    // case a human has to decide what happens to the money.
    const { data: charge, error: chargeError } = await sb.from('dues_charges')
      .select('id').eq('member_id', memberId).eq('term_id', term.id).maybeSingle();
    fail('read charge', chargeError);
    if (charge) {
      const { data: paid, error: paidError } = await sb.from('payments')
        .select('id').eq('charge_id', charge.id).limit(1);
      fail('read payments', paidError);
      if (paid?.length) {
        throw new Error(
          'A payment is already applied to this term for him. Undo it first, then mark him abroad.',
        );
      }
      fail('remove the charge',
        (await sb.from('dues_charges').delete().eq('id', charge.id)).error);
    }

    const { error } = await sb.from('exemptions').upsert({
      member_id: memberId,
      term_id: term.id,
      reason: reason.trim(),
      created_by: await actorEmail(),
    }, { onConflict: 'member_id,term_id', ignoreDuplicates: true });
    fail('mark abroad', error);
  },

  async removeExempt(memberId: string) {
    const sb = activeClient();
    const term = await currentTerm();
    fail('remove the exemption', (await sb.from('exemptions')
      .delete().eq('member_id', memberId).eq('term_id', term.id)).error);
  },

  async issueCharges() {
    const sb = activeClient();
    const term = await currentTerm();
    if (!term.duesCents) throw new Error('Set the term dues amount first.');

    const [{ data: members, error: mError }, { data: existing, error: cError },
      { data: exempt, error: eError }] = await Promise.all([
      sb.from('members').select('id'),
      sb.from('dues_charges').select('member_id').eq('term_id', term.id),
      sb.from('exemptions').select('member_id').eq('term_id', term.id),
    ]);
    fail('read members', mError);
    fail('read charges', cError);
    fail('read exemptions', eError);

    const charged = new Set((existing ?? []).map((r: any) => r.member_id));
    // Brothers who are abroad are skipped, not charged and then zeroed out.
    (exempt ?? []).forEach((r: any) => charged.add(r.member_id));
    const missing = (members ?? []).filter((m: any) => !charged.has(m.id));
    if (!missing.length) return 0;

    const { error } = await sb.from('dues_charges').insert(missing.map((m: any) => ({
      member_id: m.id,
      term_id: term.id,
      amount_cents: term.duesCents,
      description: `${term.label} dues`,
    })));
    fail('issue charges', error);
    return missing.length;
  },

  async grantOppFund(input: OppFundInput) {
    if (input.amountCents <= 0) throw new Error('An opportunity fund grant must be more than zero.');
    const sb = getServerSupabase();
    const term = await currentTerm();
    const { error } = await sb.from('adjustments').insert({
      member_id: input.memberId,
      term_id: term.id,
      amount_cents: input.amountCents,
      kind: 'opp_fund',
      reason: input.reason.trim(),
      created_by: await actorEmail(),
    });
    fail('grant opportunity fund', error);
  },

  async removeAdjustment(adjustmentId: string) {
    const sb = getServerSupabase();
    fail('remove grant', (await sb.from('adjustments').delete().eq('id', adjustmentId)).error);
  },

  async setAutoApply(enabled: boolean) {
    const sb = getServerSupabase();
    const term = await currentTerm();
    fail('save auto-apply setting',
      (await sb.from('terms').update({ auto_apply: enabled }).eq('id', term.id)).error);
  },

  async getBankStatus(): Promise<BankStatus> {
    // Reads with the SESSION client on purpose. bank_connection and sync_runs are
    // select-only for execs; sync_state — which holds the access token and the
    // cursor — has RLS on with no policies at all, so this client cannot reach it
    // even by mistake.
    const sb = getServerSupabase();
    const [conn, runs] = await Promise.all([
      sb.from('bank_connection').select('*').eq('id', 1).maybeSingle(),
      sb.from('sync_runs').select('*').order('started_at', { ascending: false }).limit(10),
    ]);
    fail('read bank connection', conn.error);
    fail('read sync history', runs.error);

    const c = conn.data;
    return {
      connected: Boolean(c?.item_id),
      institutionName: c?.institution_name ?? null,
      accountName: c?.account_name ?? null,
      accountMask: c?.account_mask ?? null,
      accountSelected: Boolean(c?.account_name),
      connectedAt: c?.connected_at ?? null,
      lastSyncedAt: c?.last_synced_at ?? null,
      needsReauth: Boolean(c?.needs_reauth),
      lastError: c?.last_error ?? null,
      runs: (runs.data ?? []).map(toRun),
    };
  },

  async applyFeedPage(input: FeedPageInput): Promise<FeedApplyResult> {
    // The feed writer always runs on the service client: it is reached from a
    // cron route and a webhook, neither of which carries an exec session.
    const sb = getServiceSupabase();
    const term = await currentTerm();
    const insertedTxnIds: string[] = [];
    const settledTxnIds: string[] = [];
    let modifiedCount = 0;
    let removedCount = 0;
    let reversedCount = 0;
    let ignoredRemovedCount = 0;

    /* ---- added: promotions first, then genuinely new rows ---- */
    const pendingIds = input.added.map((f) => f.pendingTxnId).filter(Boolean) as string[];
    const known = new Map<string, any>();   // provider id → the stored row
    if (pendingIds.length) {
      const { data, error } = await sb.from('bank_txns')
        .select('id, provider_txn_id, status, amount_cents').in('provider_txn_id', pendingIds);
      fail('read pending credits', error);
      (data ?? []).forEach((r: any) => known.set(r.provider_txn_id, r));
    }

    const fresh = [] as any[];
    for (const f of input.added) {
      if (f.amountCents === 0) throw new Error('The feed produced a zero-amount credit.');
      const promotedRow = f.pendingTxnId ? known.get(f.pendingTxnId) : undefined;
      if (promotedRow) {
        // Update in place: the row keeps its id, so a payment already applied to
        // the pending credit stays attached and the money is counted once.
        // Inserting a second row here is the easiest way to double-count dues.
        // A pending credit can already have been applied by an exec — it sits in
        // the queue like any other. If it settles at a different amount, that
        // breaks the same invariant the `modified` path guards, so it gets the
        // same flag rather than silently rewriting the amount under a payment.
        const changed = promotedRow.status === 'applied'
          && promotedRow.amount_cents !== f.amountCents;
        const { error } = await sb.from('bank_txns').update({
          provider_txn_id: f.providerTxnId,
          pending_txn_id: f.pendingTxnId,
          posted_on: f.postedOn,
          amount_cents: f.amountCents,
          raw_description: f.rawDescription,
          pending: false,
          ...(changed ? { amount_changed_at: new Date().toISOString() } : {}),
        }).eq('id', promotedRow.id);
        fail('settle pending credit', error);
        settledTxnIds.push(promotedRow.id);
        continue;
      }
      fresh.push({
        provider_txn_id: f.providerTxnId,
        pending_txn_id: f.pendingTxnId,
        account_id: f.accountId,
        posted_on: f.postedOn,
        amount_cents: f.amountCents,
        raw_description: f.rawDescription,
        pending: f.pending,
        source: 'plaid',
        status: 'queued',
        entered_by: input.actor,
      });
    }

    if (fresh.length) {
      // ignoreDuplicates → ON CONFLICT DO NOTHING, and RETURNING under DO NOTHING
      // emits only genuinely-inserted rows. Re-syncing an overlapping window
      // therefore inserts nothing and reports nothing as new.
      const { data, error } = await sb.from('bank_txns')
        .upsert(fresh, { onConflict: 'provider_txn_id', ignoreDuplicates: true })
        .select('id');
      fail('record credits', error);
      insertedTxnIds.push(...(data ?? []).map((r: any) => r.id));
    }

    /* ---- modified: targeted per-row, never a blanket upsert ---- */
    for (const f of input.modified) {
      const { data: row, error: readError } = await sb.from('bank_txns')
        .select('id, status, amount_cents').eq('provider_txn_id', f.providerTxnId).maybeSingle();
      fail('read credit', readError);
      if (!row) continue;   // dropped as a debit, wrong account, or before the floor

      const patch: Record<string, unknown> = {
        posted_on: f.postedOn,
        amount_cents: f.amountCents,
        raw_description: f.rawDescription,
        pending: f.pending,
      };
      // An amount that changes after the credit was applied breaks the invariant
      // applyCredit enforces. Flag it for a human instead of drifting silently.
      if (row.status === 'applied' && row.amount_cents !== f.amountCents) {
        patch.amount_changed_at = new Date().toISOString();
      }
      // status, id and entered_by are deliberately absent from the patch.
      fail('update credit', (await sb.from('bank_txns').update(patch).eq('id', row.id)).error);
      modifiedCount++;
    }

    /* ---- removed: the bank says it never happened ---- */
    for (const providerTxnId of input.removed) {
      // A pending row we already promoted — checked FIRST, or the promotion would
      // immediately be undone and a real payment reversed.
      // pending_txn_id carries a plain index, not a unique constraint, so this
      // must tolerate more than one row rather than erroring and wedging the page.
      const { data: promoted } = await sb.from('bank_txns')
        .select('id').eq('pending_txn_id', providerTxnId)
        .neq('provider_txn_id', providerTxnId).limit(1);
      if (promoted?.length) { ignoredRemovedCount++; continue; }

      const { data: row, error: readError } = await sb.from('bank_txns')
        .select('*').eq('provider_txn_id', providerTxnId).maybeSingle();
      fail('read credit', readError);
      if (!row) { ignoredRemovedCount++; continue; }

      removedCount++;
      const now = new Date().toISOString();

      // Branch on whether money was applied, NOT on status. A partially-undone
      // split sits at status 'queued' while the other half's payment is still
      // live; branching on status would set it aside and leave that brother
      // marked paid for money the bank took back.
      const { data: applied, error: payError } = await sb.from('payments')
        .select('*').eq('bank_txn_id', row.id);
      fail('read payments', payError);
      const payments = applied ?? [];

      if (!payments.length) {
        fail('set credit aside', (await sb.from('bank_txns')
          .update({ removed_at: now, status: 'set_aside' }).eq('id', row.id)).error);
        continue;
      }

      // A reversal needs its own transaction to hang off: payments are unique on
      // (bank_txn_id, member_id), so a negative row cannot sit beside the positive
      // one it reverses. The mirror's provider id is deterministic, so a crash
      // mid-reversal replays safely instead of reversing twice.
      const { data: mirror, error: mirrorError } = await sb.from('bank_txns')
        .upsert({
          provider_txn_id: `${providerTxnId}:removed`,
          account_id: row.account_id,
          posted_on: now.slice(0, 10),
          amount_cents: -payments.reduce((a: number, p: any) => a + p.amount_cents, 0),
          raw_description: `REMOVED BY BANK — ${row.raw_description}`,
          pending: false,
          removed_at: now,
          source: 'plaid',
          status: 'applied',      // never enters the queue
          entered_by: input.actor,
        }, { onConflict: 'provider_txn_id', ignoreDuplicates: false })
        .select('id').single();
      fail('record the reversal', mirrorError);
      if (!mirror) throw new Error('The reversal transaction could not be created.');

      if (payments.length) {
        // One negative payment per existing payment, so a credit split across two
        // brothers reverses both halves rather than one lump.
        const { error: reverseError } = await sb.from('payments').upsert(
          payments.map((p: any) => ({
            bank_txn_id: mirror.id,
            member_id: p.member_id,
            // The term the money was applied to, not whatever term is current.
            // A Fall credit reversed in January must un-credit Fall.
            term_id: p.term_id,
            charge_id: p.charge_id,
            amount_cents: -p.amount_cents,
            applied_by: input.actor,
            reason: `The bank reported this credit removed. Reversing ${formatCents(p.amount_cents)}.`,
          })),
          { onConflict: 'bank_txn_id,member_id', ignoreDuplicates: true },
        );
        fail('reverse payments', reverseError);
        reversedCount += payments.length;
      }

      fail('mark credit removed', (await sb.from('bank_txns')
        .update({ removed_at: now }).eq('id', row.id)).error);
    }

    return {
      insertedTxnIds, settledTxnIds, modifiedCount, removedCount, reversedCount,
      ignoredRemovedCount,
    };
  },
};
