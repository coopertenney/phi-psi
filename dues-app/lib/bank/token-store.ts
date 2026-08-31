import 'server-only';
import { randomUUID } from 'crypto';
import { getServiceSupabase } from '../supabase/service';
import { isSupabaseConfigured } from '../config';
import type { SyncResult, SyncTrigger } from './types';
import type { SyncState, SyncStore } from './sync';

// The only module that names `sync_state.access_token`.
//
// The token is a bearer credential for read access to the chapter's entire bank
// account, usable from anywhere with curl. The threat model isn't a stranger on
// the internet — it's a phished treasurer password or an exec account that
// outlives the exec. Nothing in the product needs a human to see the token, so
// nothing is able to: `sync_state` has RLS on with zero policies AND its grants
// revoked, so neither the anon key nor a signed-in exec can read it. Only the
// service role gets there, and only through this file.
//
// Note the shape of withAccessToken: the token is passed INTO a callback and is
// never a return value, so it cannot accidentally be handed to a React tree or
// returned from a server action.

const LOCK_MINUTES = 5;

export async function withAccessToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
  const sb = getServiceSupabase();
  const { data, error } = await sb.from('sync_state').select('access_token').eq('id', 1).maybeSingle();
  if (error) throw new Error(`read bank credentials: ${error.message}`);
  if (!data?.access_token) throw new Error('No bank account is connected.');
  return fn(data.access_token);
}

export interface StoredConnection {
  connected: boolean;
  itemId: string | null;
  accountId: string | null;
}

/** Redacted by construction — there is no code path that returns the token. */
export async function getConnection(): Promise<StoredConnection> {
  const sb = getServiceSupabase();
  const { data, error } = await sb.from('sync_state')
    .select('item_id, account_id, access_token').eq('id', 1).maybeSingle();
  if (error) throw new Error(`read bank connection: ${error.message}`);
  return {
    connected: Boolean(data?.access_token),
    itemId: data?.item_id ?? null,
    accountId: data?.account_id ?? null,
  };
}

export interface SaveConnectionInput {
  accessToken: string;
  itemId: string;
  accountId: string | null;
  ingestFrom: string;
  institutionName: string | null;
  accountName: string | null;
  accountMask: string | null;
}

/**
 * Second line of defence against a second Plaid Item, not the first — by the
 * time an exchange happens the Item already exists at Plaid and the lifetime
 * slot is already consumed. The real guard is PLAID_ALLOW_NEW_ITEM, checked
 * before a connect-mode link token is ever created.
 */
export async function saveConnection(input: SaveConnectionInput): Promise<void> {
  const sb = getServiceSupabase();
  const existing = await getConnection();
  if (existing.connected) {
    throw new Error(
      'This app holds exactly one bank connection, and one is already stored. '
      + 'Use Reconnect — it re-authenticates the existing connection instead of '
      + 'permanently consuming another of ten lifetime Plaid connections.',
    );
  }

  const now = new Date().toISOString();
  const { error } = await sb.from('sync_state').upsert({
    id: 1,
    access_token: input.accessToken,
    item_id: input.itemId,
    account_id: input.accountId,
    ingest_from: input.ingestFrom,
    cursor: null,
  }, { onConflict: 'id' });
  if (error) throw new Error(`save bank connection: ${error.message}`);

  const { error: connError } = await sb.from('bank_connection').upsert({
    id: 1,
    institution_name: input.institutionName,
    item_id: input.itemId,
    account_name: input.accountName,
    account_mask: input.accountMask,
    connected_at: now,
    needs_reauth: false,
    last_error: null,
  }, { onConflict: 'id' });
  if (connError) throw new Error(`save bank connection: ${connError.message}`);
}

export async function selectAccount(accountId: string, name: string, mask: string | null) {
  const sb = getServiceSupabase();
  const { error } = await sb.from('sync_state').update({ account_id: accountId }).eq('id', 1);
  if (error) throw new Error(`choose account: ${error.message}`);
  await sb.from('bank_connection').update({ account_name: name, account_mask: mask }).eq('id', 1);
}

export async function clearReauth(): Promise<void> {
  const sb = getServiceSupabase();
  await sb.from('bank_connection').update({ needs_reauth: false, last_error: null }).eq('id', 1);
}

/** The live SyncStore. Its in-memory twin is in ./mock-sync-store.ts. */
export const supabaseSyncStore: SyncStore = {
  async load(): Promise<SyncState> {
    const sb = getServiceSupabase();
    const { data, error } = await sb.from('sync_state')
      .select('access_token, cursor, account_id, ingest_from').eq('id', 1).maybeSingle();
    if (error) throw new Error(`read sync state: ${error.message}`);
    return {
      accessToken: data?.access_token ?? null,
      cursor: data?.cursor ?? null,
      accountId: data?.account_id ?? null,
      ingestFrom: data?.ingest_from ?? null,
    };
  },

  async saveCursor(cursor: string) {
    const sb = getServiceSupabase();
    const { error } = await sb.from('sync_state').update({ cursor }).eq('id', 1);
    // Loud on purpose: a cursor that silently fails to save replays a page next
    // run, which is harmless — but a cursor that saves when the writes didn't is
    // the one failure that loses money permanently, so neither is left to chance.
    if (error) throw new Error(`save sync cursor: ${error.message}`);
  },

  async acquireLock(): Promise<string | null> {
    const sb = getServiceSupabase();
    const stale = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
    const lockId = randomUUID();
    const { data, error } = await sb.from('sync_state')
      .update({ locked_at: new Date().toISOString(), lock_id: lockId })
      .eq('id', 1)
      .or(`locked_at.is.null,locked_at.lt.${stale}`)
      .select('lock_id');
    if (error) throw new Error(`start sync: ${error.message}`);
    return data?.length ? lockId : null;
  },

  async releaseLock(lockId: string) {
    // Scoped to the lock we actually took. A long run that overran the steal
    // window must not clear the lock a newer run has since acquired — that
    // would let a third run start alongside it, against the same cursor.
    const sb = getServiceSupabase();
    await sb.from('sync_state')
      .update({ locked_at: null, lock_id: null })
      .eq('id', 1).eq('lock_id', lockId);
  },

  async startRun(trigger: SyncTrigger): Promise<string> {
    const sb = getServiceSupabase();
    const { data, error } = await sb.from('sync_runs').insert({ trigger }).select('id').single();
    if (error) throw new Error(`record sync run: ${error.message}`);
    return data.id;
  },

  async finishRun(runId: string, result: SyncResult) {
    const sb = getServiceSupabase();
    await sb.from('sync_runs').update({
      finished_at: new Date().toISOString(),
      added_count: result.addedCount,
      settled_count: result.settledCount,
      modified_count: result.modifiedCount,
      removed_count: result.removedCount,
      reversed_count: result.reversedCount,
      dropped_debit_count: result.droppedDebitCount,
      dropped_before_floor_count: result.droppedBeforeFloorCount,
      auto_applied_count: result.autoAppliedCount,
      status: result.status,
      error: result.error,
    }).eq('id', runId);
  },

  async markNeedsReauth(message: string) {
    const sb = getServiceSupabase();
    // The message is a Plaid error code, never the token — see the note above.
    await sb.from('bank_connection')
      .update({ needs_reauth: true, last_error: message.slice(0, 500) }).eq('id', 1);
  },

  async markSynced() {
    const sb = getServiceSupabase();
    await sb.from('bank_connection').update({ last_synced_at: new Date().toISOString() }).eq('id', 1);
  },
};

export const isTokenStoreLive = isSupabaseConfigured && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
