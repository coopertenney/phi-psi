/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build output dir. Defaults to `.next` (what Vercel and plain `next build`
  // use). Overridable via env so a local prod server (`next start`) can run from
  // its own directory alongside a `next dev` server without the two clobbering
  // each other's `.next`. Harmless in CI/prod where the env var is unset.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
