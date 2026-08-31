import { AsyncLocalStorage } from 'async_hooks';

// Which Supabase client the backend should reach for.
//
// No `server-only` here on purpose: this module holds no secret, and the tsx
// harnesses in scripts/ import the sync path directly. lib/supabase/service.ts,
// which does hold the key, keeps its guard.
//
// Everything in this app normally runs behind an exec's session cookie, and RLS
// is what makes that safe. But the daily sync runs from a cron route with no
// session at all — and `terms`, `dues_charges` and `payments` all have
// `to authenticated` policies, so a session-less read returns zero rows and a
// write is silently refused. That failure is invisible: the sync reports
// "no current term is set" and the cursor never moves.
//
// So a sync wraps itself in runAsService(), and the backend switches clients for
// the duration. The scope is deliberately narrow: it is entered only by
// lib/bank/sync.ts, and never by anything that renders a page.

const storage = new AsyncLocalStorage<boolean>();

export function runAsService<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run(true, fn);
}

export function isServiceContext(): boolean {
  return storage.getStore() === true;
}
