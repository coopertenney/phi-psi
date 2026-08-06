import { createClient, SupabaseClient } from '@supabase/supabase-js';

export function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error('Supabase URL and anon key are required');
  }
  return createClient(url, anonKey);
}
