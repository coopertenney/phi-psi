// Which SyncStore runSync uses, on the same principle as lib/db.ts: with a
// service-role key present the run persists to Supabase, without one it runs in
// memory. Pages and routes never branch on this themselves.

import { mockSyncStore } from './mock-sync-store';
import { isTokenStoreLive, supabaseSyncStore } from './token-store';
import type { SyncStore } from './sync';

export const syncStore: SyncStore = isTokenStoreLive ? supabaseSyncStore : mockSyncStore;
export const isSyncLive = isTokenStoreLive;
