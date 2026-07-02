// The seed chapter id. Lives in its own file (no server-only imports) so
// CLIENT components can import it directly — importing it from lib/data/
// index.ts would drag lib/supabase/server.ts (next/headers) into the client
// bundle, which Next.js rejects at build time.
export const CHAPTER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
