'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { runSync } from '@/lib/bank/sync';
import { bankProvider } from '@/lib/bank/provider';
import { syncStore } from '@/lib/bank/store';
import { isSyncLive } from '@/lib/bank/store';
import { mockSyncState } from '@/lib/bank/mock-sync-store';
import { selectAccount, withAccessToken } from '@/lib/bank/token-store';
import { db, isMockBackend } from '@/lib/db';
import { getServerSupabase } from '@/lib/supabase/server';
import type { BankAccount } from '@/lib/bank/types';

// Lives here rather than in app/actions.ts so the bank module graph never sits
// behind a file a 'use client' component imports.

async function actor(): Promise<string> {
  if (isMockBackend) return 'Exec (mock)';
  const { data } = await getServerSupabase().auth.getUser();
  if (!data.user) throw new Error('Sign in first.');
  return data.user.email ?? 'exec';
}

function describe(result: Awaited<ReturnType<typeof runSync>>): string {
  switch (result.status) {
    case 'busy': return 'A sync is already running — give it a moment.';
    case 'not_connected': return 'No bank account is connected yet.';
    case 'account_not_selected': return 'Choose which account holds dues before syncing.';
    case 'needs_reauth': return 'The bank needs you to sign in again — use Reconnect.';
    case 'error': return result.error ?? 'The sync failed.';
    default: break;
  }
  const parts: string[] = [];
  if (result.addedCount) parts.push(`${result.addedCount} new credit${result.addedCount === 1 ? '' : 's'}`);
  if (result.settledCount) parts.push(`${result.settledCount} settled`);
  if (result.autoAppliedCount) parts.push(`${result.autoAppliedCount} applied automatically`);
  if (result.reversedCount) parts.push(`${result.reversedCount} payment${result.reversedCount === 1 ? '' : 's'} reversed by the bank`);
  if (result.droppedDebitCount) parts.push(`${result.droppedDebitCount} debits ignored`);
  return parts.length ? `${parts.join(', ')}.` : 'Nothing new since the last check.';
}

export async function syncNowAction() {
  let message: string;
  try {
    const result = await runSync({
      provider: bankProvider,
      backend: db,
      store: syncStore,
      trigger: 'manual',
      actor: await actor(),
    });
    message = describe(result);
  } catch (e) {
    const text = e instanceof Error ? e.message : 'The sync failed.';
    redirect(`/?error=${encodeURIComponent(text)}`);
  }
  revalidatePath('/');
  revalidatePath('/bank');
  redirect(`/?ok=${encodeURIComponent(message)}`);
}

export async function setAutoApplyAction(formData: FormData) {
  const enabled = formData.get('autoApply') === 'on';
  try {
    await db.setAutoApply(enabled);
  } catch (e) {
    const text = e instanceof Error ? e.message : 'Could not save that.';
    redirect(`/bank?error=${encodeURIComponent(text)}`);
  }
  revalidatePath('/bank');
  redirect(`/bank?ok=${encodeURIComponent(
    enabled ? 'Certain matches will be applied automatically.' : 'Every credit will wait for you.',
  )}`);
}

/**
 * The accounts on the connected Item, for the picker. A bank Item can expose
 * checking AND savings, and an internal transfer between them arrives looking
 * exactly like a dues payment — so the sync refuses to run until one is chosen,
 * and this is how it gets chosen.
 */
export async function selectableAccounts(): Promise<BankAccount[]> {
  const accounts = isSyncLive
    ? await withAccessToken((token) => bankProvider.getAccounts(token))
    : await bankProvider.getAccounts('mock-access-token');
  return accounts.filter((a) => a.type === 'depository');
}

export async function chooseAccountAction(formData: FormData) {
  const accountId = String(formData.get('accountId') ?? '');
  try {
    if (!accountId) throw new Error('Pick the account that receives dues.');
    const account = (await selectableAccounts()).find((a) => a.accountId === accountId);
    if (!account) throw new Error('That account is no longer on the connection.');
    if (isSyncLive) {
      await selectAccount(account.accountId, account.name, account.mask);
    } else {
      mockSyncState.accountId = account.accountId;
    }
  } catch (e) {
    const text = e instanceof Error ? e.message : 'Could not save that.';
    redirect(`/bank?error=${encodeURIComponent(text)}`);
  }
  revalidatePath('/bank');
  redirect(`/bank?ok=${encodeURIComponent('Dues will be read from that account.')}`);
}
