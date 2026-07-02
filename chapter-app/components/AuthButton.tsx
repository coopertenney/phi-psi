'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase, isSupabaseConfigured } from '@/lib/supabase/browser';

// Shows the signed-in account's email + a Sign out button. Renders nothing when
// Supabase isn't configured (mock mode has no real auth).
export function AuthButton() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getBrowserSupabase();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  if (!isSupabaseConfigured) return null;

  async function signOut() {
    await getBrowserSupabase().auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderLeft: '1px solid var(--line-200, #e6e8e3)', paddingLeft: 14 }}>
      {email && <span style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{email}</span>}
      <button
        onClick={signOut}
        style={{
          padding: '6px 11px', borderRadius: 8, border: '1px solid var(--line-200, #d8dad4)',
          background: 'transparent', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', color: 'var(--ink-700, #374151)',
        }}
      >
        Sign out
      </button>
    </div>
  );
}
