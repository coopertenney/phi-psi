import { isSupabaseConfigured } from './config';
import { mockBackend } from './mock-store';
import { supabaseBackend } from './supabase-backend';
import type { DuesBackend } from './backend';

// One switch for the whole app: env vars present → Supabase, absent → the
// in-memory store (and middleware skips auth entirely), so localhost renders
// with no project. Pages and actions never branch on this themselves.
export const db: DuesBackend = isSupabaseConfigured ? supabaseBackend : mockBackend;

export const isMockBackend = !isSupabaseConfigured;
