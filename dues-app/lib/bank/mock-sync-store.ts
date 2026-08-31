// The in-memory twin of the Supabase sync store. Lets runSync — the lock, the
// cursor ordering, the run log — execute end to end on localhost with no
// Supabase project, which is what makes scripts/check-sync.ts possible.

import { randomUUID } from 'crypto';
import { MOCK_ACCOUNT_ID } from './mock-provider';
import type { SyncResult, SyncTrigger } from './types';
import type { SyncRunRow } from '../types';
import type { SyncState, SyncStore } from './sync';

interface MockSyncState extends SyncState {
  lockId: string | null;
  runs: SyncRunRow[];
  connected: boolean;
  lastSyncedAt: string | null;
  needsReauth: boolean;
  lastError: string | null;
}

const globalStore = globalThis as unknown as { __duesMockSync?: MockSyncState };

export const mockSyncState: MockSyncState = (globalStore.__duesMockSync ??= {
  // Pre-connected: on the mock backend there is no Plaid Link to walk through,
  // and the point of the mock is to exercise the sync, not the OAuth dance.
  accessToken: 'mock-access-token',
  cursor: null,
  accountId: MOCK_ACCOUNT_ID,
  ingestFrom: null,
  lockId: null,
  runs: [],
  connected: true,
  lastSyncedAt: null,
  needsReauth: false,
  lastError: null,
});

export const mockSyncStore: SyncStore = {
  async load(): Promise<SyncState> {
    const { accessToken, cursor, accountId, ingestFrom } = mockSyncState;
    return { accessToken, cursor, accountId, ingestFrom };
  },
  async saveCursor(cursor: string) { mockSyncState.cursor = cursor; },
  async acquireLock() {
    if (mockSyncState.lockId) return null;
    mockSyncState.lockId = randomUUID();
    return mockSyncState.lockId;
  },
  async releaseLock(lockId: string) {
    if (mockSyncState.lockId === lockId) mockSyncState.lockId = null;
  },
  async startRun(trigger: SyncTrigger) {
    const id = randomUUID();
    mockSyncState.runs.unshift({
      id, trigger, startedAt: new Date().toISOString(), finishedAt: null,
      addedCount: 0, settledCount: 0, modifiedCount: 0, removedCount: 0, reversedCount: 0,
      droppedDebitCount: 0, autoAppliedCount: 0, status: 'running', error: null,
    });
    return id;
  },
  async finishRun(runId: string, result: SyncResult) {
    const run = mockSyncState.runs.find((r) => r.id === runId);
    if (!run) return;
    Object.assign(run, {
      finishedAt: new Date().toISOString(),
      addedCount: result.addedCount,
      settledCount: result.settledCount,
      modifiedCount: result.modifiedCount,
      removedCount: result.removedCount,
      reversedCount: result.reversedCount,
      droppedDebitCount: result.droppedDebitCount,
      autoAppliedCount: result.autoAppliedCount,
      status: result.status,
      error: result.error,
    });
  },
  async markNeedsReauth(message: string) {
    mockSyncState.needsReauth = true;
    mockSyncState.lastError = message;
  },
  async markSynced() { mockSyncState.lastSyncedAt = new Date().toISOString(); },
};
