import { getServerSupabase } from './supabase/server';
import type { ApplyCreditInput, DuesBackend, OppFundInput, RecordCreditInput } from './backend';
import type {
  Adjustment, BankTxn, DuesCharge, LedgerStatus, MemberRow, NameAlias, PaymentRow, PublicBalance,
  Snapshot, Term,
} from './types';
import { aliasToLearn, normalizeName } from './match';

// The live backend. Reads the whole term in one round of parallel selects —
// ~105 members and a few hundred rows, so paging would cost more than it saves.

function fail(context: string, error: { message: string } | null) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

const toMember = (r: any): MemberRow => ({
  id: r.id, name: r.name, aka: r.aka ?? [], photoUrl: r.photo_url ?? null,
});
const toTerm = (r: any): Term => ({
  id: r.id, label: r.label, isCurrent: r.is_current, duesCents: r.dues_cents ?? null,
});
const toCharge = (r: any): DuesCharge => ({
  id: r.id, memberId: r.member_id, termId: r.term_id, amountCents: r.amount_cents,
  description: r.description ?? '',
});
const toTxn = (r: any): BankTxn => ({
  id: r.id, providerTxnId: r.provider_txn_id, postedOn: r.posted_on, amountCents: r.amount_cents,
  rawDescription: r.raw_description, pending: r.pending, removedAt: r.removed_at,
  source: r.source, status: r.status, enteredBy: r.entered_by ?? '',
});
const toPayment = (r: any): PaymentRow => ({
  id: r.id, bankTxnId: r.bank_txn_id, memberId: r.member_id, chargeId: r.charge_id,
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
  const sb = getServerSupabase();
  const { data } = await sb.auth.getUser();
  return data.user?.email ?? 'exec';
}

async function currentTerm(): Promise<Term> {
  const sb = getServerSupabase();
  const { data, error } = await sb.from('terms').select('*').eq('is_current', true).maybeSingle();
  fail('read current term', error);
  if (!data) throw new Error('No current term is set.');
  return toTerm(data);
}

async function chargeIdFor(memberId: string, termId: string): Promise<string | null> {
  const sb = getServerSupabase();
  const { data, error } = await sb.from('dues_charges')
    .select('id').eq('member_id', memberId).eq('term_id', termId).maybeSingle();
  fail('read charge', error);
  return data?.id ?? null;
}

export const supabaseBackend: DuesBackend = {
  async getSnapshot(): Promise<Snapshot> {
    const sb = getServerSupabase();
    const [members, terms, charges, txns, payments, adjustments, aliases, actor] = await Promise.all([
      sb.from('members').select('id, name, aka, photo_url').order('name'),
      sb.from('terms').select('*').order('created_at', { ascending: false }),
      sb.from('dues_charges').select('*'),
      sb.from('bank_txns').select('*').order('posted_on'),
      sb.from('payments').select('*').order('created_at'),
      sb.from('adjustments').select('*'),
      sb.from('name_aliases').select('*').order('created_at', { ascending: false }),
      actorEmail(),
    ]);
    fail('read members', members.error);
    fail('read terms', terms.error);
    fail('read charges', charges.error);
    fail('read bank transactions', txns.error);
    fail('read payments', payments.error);
    fail('read adjustments', adjustments.error);
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
    const sb = getServerSupabase();
    const term = await currentTerm();
    const actor = await actorEmail();

    const { data: txnRow, error: txnError } = await sb.from('bank_txns')
      .select('*').eq('id', input.txnId).maybeSingle();
    fail('read credit', txnError);
    if (!txnRow) throw new Error('That credit no longer exists.');
    const txn = toTxn(txnRow);

    const total = input.allocations.reduce((a, x) => a + x.amountCents, 0);
    if (!input.allocations.length) throw new Error('Pick at least one brother.');
    if (total !== txn.amountCents) throw new Error('The split has to add up to the credit exactly.');
    const ids = input.allocations.map((a) => a.memberId);
    if (new Set(ids).size !== ids.length) throw new Error('Pick two different brothers.');

    const rows = await Promise.all(input.allocations.map(async (a) => ({
      bank_txn_id: txn.id,
      member_id: a.memberId,
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
    const { data, error } = await sb.from('payments').select('bank_txn_id').eq('id', paymentId).maybeSingle();
    fail('read payment', error);
    if (!data) throw new Error('That payment no longer exists.');
    fail('undo payment', (await sb.from('payments').delete().eq('id', paymentId)).error);

    const { data: siblings, error: sibError } = await sb.from('payments')
      .select('id').eq('bank_txn_id', data.bank_txn_id);
    fail('read payments', sibError);
    if (!siblings?.length) {
      fail('requeue credit', (await sb.from('bank_txns').update({ status: 'queued' }).eq('id', data.bank_txn_id)).error);
    }
  },

  async setTermDues(amountCents: number) {
    if (amountCents <= 0) throw new Error('Dues must be more than zero.');
    const sb = getServerSupabase();
    const term = await currentTerm();
    fail('set dues', (await sb.from('terms').update({ dues_cents: amountCents }).eq('id', term.id)).error);
  },

  async issueCharges() {
    const sb = getServerSupabase();
    const term = await currentTerm();
    if (!term.duesCents) throw new Error('Set the term dues amount first.');

    const [{ data: members, error: mError }, { data: existing, error: cError }] = await Promise.all([
      sb.from('members').select('id'),
      sb.from('dues_charges').select('member_id').eq('term_id', term.id),
    ]);
    fail('read members', mError);
    fail('read charges', cError);

    const charged = new Set((existing ?? []).map((r: any) => r.member_id));
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
};
