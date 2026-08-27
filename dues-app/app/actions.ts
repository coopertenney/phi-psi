'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { parseAmountToCents } from '@/lib/money';

// Every action funnels failures back to the page as ?error=, so an exec sees
// "the split has to add up" in the UI instead of a Next.js error screen.
async function run(path: string, fn: () => Promise<void>, okMessage?: string) {
  try {
    await fn();
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Something went wrong.';
    redirect(`${path}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(path);
  redirect(okMessage ? `${path}?ok=${encodeURIComponent(okMessage)}` : path);
}

const str = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

export async function recordCreditAction(formData: FormData) {
  const rawDescription = str(formData, 'rawDescription');
  const amountCents = parseAmountToCents(str(formData, 'amount'));
  const postedOn = str(formData, 'postedOn');
  const pending = formData.get('pending') === 'on';

  await run('/', async () => {
    if (amountCents === null) throw new Error('Amount has to be a number, like 450 or 450.00.');
    if (!postedOn) throw new Error('Pick the date the credit posted.');
    await db.recordCredit({ rawDescription, amountCents, postedOn, pending });
  }, 'Credit added to the queue.');
}

// Confirm the app's own guess: the whole credit goes to one brother.
export async function confirmMatchAction(formData: FormData) {
  const txnId = str(formData, 'txnId');
  const memberId = str(formData, 'memberId');
  const amountCents = Number(str(formData, 'amountCents'));
  const reason = str(formData, 'reason');

  await run('/', async () => {
    if (!memberId) throw new Error('Pick a brother first.');
    await db.applyCredit({
      txnId,
      allocations: [{ memberId, amountCents }],
      learnAliasFor: memberId,
      reason,
    });
  }, 'Payment applied.');
}

// The picker: one brother, or a credit split across two.
export async function applyCreditAction(formData: FormData) {
  const txnId = str(formData, 'txnId');
  const memberA = str(formData, 'memberA');
  const memberB = str(formData, 'memberB');
  const amountCents = Number(str(formData, 'amountCents'));
  const firstShare = Number(str(formData, 'firstShare') || String(amountCents));
  const reason = str(formData, 'reason');

  await run('/', async () => {
    if (!memberA) throw new Error('Pick a brother first.');
    const allocations = memberB
      ? [
        { memberId: memberA, amountCents: firstShare },
        { memberId: memberB, amountCents: amountCents - firstShare },
      ]
      : [{ memberId: memberA, amountCents }];
    await db.applyCredit({ txnId, allocations, learnAliasFor: memberA, reason });
  }, 'Payment applied.');
}

export async function setAsideAction(formData: FormData) {
  const txnId = str(formData, 'txnId');
  await run('/', () => db.setAside(txnId), 'Set aside as not dues.');
}

export async function reverseAction(formData: FormData) {
  const txnId = str(formData, 'txnId');
  const memberId = str(formData, 'memberId');
  await run('/', async () => {
    if (!memberId) throw new Error('Pick whose payment came back.');
    await db.reverseCredit(txnId, memberId);
  }, 'Payment reversed.');
}

export async function loadSampleAction() {
  await run('/', async () => {
    if (!db.loadSampleCredits) throw new Error('The walkthrough only runs on the mock backend.');
    await db.loadSampleCredits();
  }, 'Walkthrough credits loaded.');
}
