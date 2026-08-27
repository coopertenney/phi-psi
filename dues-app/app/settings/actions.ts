'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { parseAmountToCents } from '@/lib/money';

async function run(fn: () => Promise<string>) {
  let message: string;
  try {
    message = await fn();
  } catch (e) {
    const text = e instanceof Error ? e.message : 'Something went wrong.';
    redirect(`/settings?error=${encodeURIComponent(text)}`);
  }
  revalidatePath('/settings');
  revalidatePath('/');
  redirect(`/settings?ok=${encodeURIComponent(message)}`);
}

const str = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

export async function setDuesAction(formData: FormData) {
  const cents = parseAmountToCents(str(formData, 'dues'));
  await run(async () => {
    if (cents === null) throw new Error('Dues has to be a number, like 450.');
    await db.setTermDues(cents);
    return 'Term dues amount saved.';
  });
}

export async function issueChargesAction() {
  await run(async () => {
    const n = await db.issueCharges();
    return n ? `Charged ${n} ${n === 1 ? 'brother' : 'brothers'}.` : 'Everyone was already charged.';
  });
}

export async function grantOppFundAction(formData: FormData) {
  const memberId = str(formData, 'memberId');
  const cents = parseAmountToCents(str(formData, 'amount'));
  const reason = str(formData, 'reason');
  await run(async () => {
    if (!memberId) throw new Error('Pick a brother.');
    if (cents === null) throw new Error('Amount has to be a number.');
    await db.grantOppFund({ memberId, amountCents: cents, reason });
    return 'Opportunity fund grant recorded.';
  });
}

export async function removeAdjustmentAction(formData: FormData) {
  const id = str(formData, 'adjustmentId');
  await run(async () => {
    await db.removeAdjustment(id);
    return 'Grant removed.';
  });
}

export async function undoPaymentAction(formData: FormData) {
  const id = str(formData, 'paymentId');
  await run(async () => {
    await db.undoPayment(id);
    return 'Payment undone — the credit is back in the queue.';
  });
}
