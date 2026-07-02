'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase, isSupabaseConfigured } from '@/lib/supabase/browser';

type Mode = 'signin' | 'signup';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // An expired/used invite link bounces here with ?error=link_expired.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('error') === 'link_expired') {
      setError('That invite link has expired or was already used. Ask an officer to re-send it.');
    }
  }, []);

  // After a session exists, match this login to its roster record (by verified
  // email). Harmless to call every time — it's a no-op once linked.
  async function linkAndEnter() {
    const supabase = getBrowserSupabase();
    const { data: linkedId, error } = await supabase.rpc('link_current_user');
    // Only block with the notice when we KNOW there's no matching roster row
    // (call succeeded, returned null). An error — e.g. the function isn't
    // installed yet — must not strand an otherwise-valid login.
    if (!error && linkedId == null) {
      setNotice(
        'You’re signed in, but your email isn’t on the chapter roster yet. ' +
          'If an officer just added you, sign out and sign in again.',
      );
      return;
    }
    router.replace('/');
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    const supabase = getBrowserSupabase();

    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email, password });
      setBusy(false);
      if (error) return setError(error.message);
      // Email confirmation ON → no session yet; OFF → session returned now.
      if (data.session) return void linkAndEnter();
      return setNotice('Check your email to confirm your account, then sign in.');
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    await linkAndEnter();
    setBusy(false);
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg-50, #f7f8f6)' }}>
      <form
        onSubmit={onSubmit}
        style={{
          width: 360, padding: 32, borderRadius: 16, background: 'var(--surface, #fff)',
          border: '1px solid var(--line-200, #e6e8e3)', boxShadow: '0 8px 30px rgba(0,0,0,0.06)',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <img src="/crest.png" alt="" width={40} height={40} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Phi Kappa Psi</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-500, #6b7280)' }}>Cal Beta · Stanford</div>
          </div>
        </div>

        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-800, #1f2937)' }}>
          {mode === 'signin' ? 'Sign in' : 'Create your account'}
        </div>

        {!isSupabaseConfigured && (
          <p style={{ fontSize: 12.5, color: '#b45309', margin: 0 }}>
            Supabase isn’t configured — running on demo data, no login needed.
          </p>
        )}

        <label style={{ fontSize: 13, fontWeight: 600 }}>
          Email
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="email" placeholder="you@stanford.edu"
            style={inputStyle}
          />
        </label>
        <label style={{ fontSize: 13, fontWeight: 600 }}>
          Password
          <input
            type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            style={inputStyle}
          />
        </label>

        {error && <p style={{ color: '#dc2626', fontSize: 12.5, margin: 0 }}>{error}</p>}
        {notice && <p style={{ color: '#166534', fontSize: 12.5, margin: 0 }}>{notice}</p>}

        <button
          type="submit" disabled={busy}
          style={{
            marginTop: 6, padding: '11px 14px', borderRadius: 10, border: 'none',
            background: 'var(--primary-600, #1f5e3a)', color: '#fff', fontWeight: 600,
            fontSize: 14, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>

        <button
          type="button"
          onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setNotice(null); }}
          style={{ background: 'none', border: 'none', color: 'var(--ink-500, #6b7280)', fontSize: 12.5, cursor: 'pointer', marginTop: -2 }}
        >
          {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', marginTop: 6, padding: '10px 12px', borderRadius: 10,
  border: '1px solid var(--line-200, #d8dad4)', fontSize: 14, fontWeight: 400,
};
