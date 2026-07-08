// Reports the commit SHA of the *currently deployed* build. The client bakes its
// own build id into its bundle (NEXT_PUBLIC_BUILD_ID, set in next.config.mjs) and
// polls this route; when the two differ, a newer deploy is live and the client
// prompts a refresh (see components/VersionWatcher.tsx). Must never be cached —
// on Vercel every request hits the current production deployment, so this always
// reflects the newest build even for a stale client.
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET() {
  const build = process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_BUILD_ID || 'dev';
  return NextResponse.json(
    { build },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
