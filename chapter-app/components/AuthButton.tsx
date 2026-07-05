'use client';

import { useRouter } from 'next/navigation';
import { getBrowserSupabase, isSupabaseConfigured } from '@/lib/supabase/browser';

// A Sign out button. The email is already visible in the profile chip next to
// this, so it isn't repeated here. Renders nothing when Supabase isn't
// configured (mock mode has no real auth).
export function AuthButton() {
  const router = useRouter();

  if (!isSupabaseConfigured) return null;

  async function signOut() {
    await getBrowserSupabase().auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      title="Sign out"
      style={{
        padding: '6px 11px', borderRadius: 8, border: '1px solid var(--line-200, #d8dad4)',
        background: 'transparent', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', color: 'var(--ink-700, #374151)',
      }}
    >
      Sign out
    </button>
  );
}
