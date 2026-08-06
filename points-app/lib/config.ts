// True once both env vars are present. Until then the app runs on an
// in-memory mock store (lib/mock-store.ts) and skips auth entirely, so
// localhost renders without a Supabase project.
export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
