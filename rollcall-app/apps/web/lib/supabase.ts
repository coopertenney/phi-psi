import { createSupabaseClient } from "@rollcall/shared";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabase = createSupabaseClient(url, anonKey);
