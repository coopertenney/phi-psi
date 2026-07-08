/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build output dir. Defaults to `.next` (what Vercel and plain `next build`
  // use). Overridable via env so a local prod server (`next start`) can run from
  // its own directory alongside a `next dev` server without the two clobbering
  // each other's `.next`. Harmless in CI/prod where the env var is unset.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Bake the deploy's commit SHA into the client bundle so VersionWatcher can tell
  // when a newer build is live (Vercel sets VERCEL_GIT_COMMIT_SHA at build time;
  // 'dev' locally, which disables the check). The /api/version route reads the
  // same value at runtime.
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
  },

  // Revalidate the HTML shell on every launch instead of trusting a cached copy —
  // the document can otherwise be served stale to an installed PWA. Excludes
  // /_next/ so Next's content-hashed JS/CSS keep their immutable long cache (those
  // bust by filename, so re-downloading them every launch would be pure waste).
  async headers() {
    return [
      {
        source: '/((?!_next/).*)',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
    ];
  },
};

export default nextConfig;
