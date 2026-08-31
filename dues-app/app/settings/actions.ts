'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { resolveNames } from '@/lib/aid';
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

export async function createTermAction(formData: FormData) {
  const label = str(formData, 'label');
  const raw = str(formData, 'dues');
  const startsOn = str(formData, 'startsOn') || null;
  const cents = raw ? parseAmountToCents(raw) : null;
  await run(async () => {
    if (raw && cents === null) throw new Error('Dues has to be a number, like 537.');
    await db.createTerm(label, cents, startsOn);
    return `${label} is now the current term. Charge the roster when you're ready.`;
  });
}

export async function markAbroadAction(formData: FormData) {
  const memberId = str(formData, 'memberId');
  const reason = str(formData, 'reason');
  await run(async () => {
    if (!memberId) throw new Error('Pick a brother.');
    await db.setExempt(memberId, reason);
    return 'Marked as abroad — not charged this term.';
  });
}

export async function clearAbroadAction(formData: FormData) {
  const memberId = str(formData, 'memberId');
  await run(async () => {
    await db.removeExempt(memberId);
    return 'Back on the roster for this term. Charge the roster again to bill him.';
  });
}

// Step one of the financial-aid import: resolve the pasted names and hand the
// result back to the page. Nothing is written here — flagging the wrong brother
// means he quietly stops being asked to pay, and nobody notices a follow-up list
// that is too short, so the exec sees the matches before they take effect.
export async function matchAidNamesAction(formData: FormData) {
  const text = String(formData.get('names') ?? '');
  if (!text.trim()) redirect('/settings?error=' + encodeURIComponent('Paste some names first.'));
  redirect(`/settings?aid=${encodeURIComponent(text.slice(0, 8000))}`);
}

export async function applyAidAction(formData: FormData) {
  const ids = formData.getAll('memberId').map((v) => String(v)).filter(Boolean);
  await run(async () => {
    if (!ids.length) throw new Error('Nothing was selected.');
    await db.setFinancialAid(ids, true);
    return `${ids.length} ${ids.length === 1 ? 'brother is' : 'brothers are'} marked as on financial aid.`;
  });
}

export async function clearAidAction(formData: FormData) {
  const memberId = str(formData, 'memberId');
  await run(async () => {
    await db.setFinancialAid([memberId], false);
    return 'Removed from the financial aid list.';
  });
}

/** Used by the page to render the confirmation step. Pure — writes nothing. */
export async function previewAidNames(text: string) {
  const snap = await db.getSnapshot();
  return resolveNames(text, snap.members);
}
