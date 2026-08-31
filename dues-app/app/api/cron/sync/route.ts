import { NextResponse, type NextRequest } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { runSync } from '@/lib/bank/sync';
import { bankProvider } from '@/lib/bank/provider';
import { syncStore } from '@/lib/bank/store';
import { db } from '@/lib/db';

// The daily pull, and the reason the whole design is safe: because state lives
// in a cursor rather than in the delivery of an event, a cron run is inherently
// a catch-up run. Miss ten webhooks and the next cron still pulls everything.
// The reverse isn't true, which is why cron is the backbone and the webhook is
// only a latency optimization.
//
// middleware.ts excludes /api entirely, so nothing authenticates this for us.
// That check is the first thing in the handler, deliberately.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  // Hash both sides first: timingSafeEqual throws when the buffers differ in
  // BYTE length, and a multi-byte character makes two equal-length strings
  // differ in bytes. Hashing gives a fixed width, so the comparison stays
  // constant-time and the route returns 401 instead of a 500.
  const a = createHash('sha256').update(header).digest();
  const b = createHash('sha256').update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Never throws: a cron that 500s is a cron nobody notices is broken. The
  // failure is recorded in sync_runs and surfaced on the desk instead.
  const result = await runSync({
    provider: bankProvider,
    backend: db,
    store: syncStore,
    trigger: 'cron',
    actor: 'Daily sync',
  });
  return NextResponse.json(result);
}
