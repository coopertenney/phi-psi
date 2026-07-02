'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase/browser';

// Invited members land here (via /auth/confirm) already signed in but with no
// password. They set one, then we auto-link them to their roster record.
export default function SetPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBrowserSupabase().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    if (password !== confirm) return setError('Passwords don’t match.');

    setBusy(true);
    const supabase = getBrowserSupabase();
    const { error: pwErr } = await supabase.auth.updateUser({ password });
    if (pwErr) {
      setBusy(false);
      // No active session usually means the link was already used or expired.
      return setError(pwErr.message.includes('session') ? 'This invite link has expired or was already used. Ask an officer to re-send it.' : pwErr.message);
    }

    const { data: linkedId, error: linkErr } = await supabase.rpc('link_current_user');
    setBusy(false);
    if (!linkErr && linkedId == null) {
      return setNotice('Password set — but your email isn’t on the chapter roster yet. Ask an officer to add you, then sign in.');
    }
    router.replace('/');
    router.refresh();
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg-50, #f7f8f6)' }}>
      <form onSubmit={onSubmit} style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <img src="/crest.png" alt="" width={40} height={40} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Phi Kappa Psi</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-500, #6b7280)' }}>Cal Beta · Stanford</div>
          </div>
        </div>

        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-800, #1f2937)' }}>Set your password</div>
        {email && <div style={{ fontSize: 12.5, color: 'var(--ink-500)', marginTop: -6 }}>for {email}</div>}

        <label style={{ fontSize: 13, fontWeight: 600 }}>
          New password
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password" style={inputStyle} />
        </label>
        <label style={{ fontSize: 13, fontWeight: 600 }}>
          Confirm password
          <input type="password" required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password" style={inputStyle} />
        </label>

        {error && <p style={{ color: '#dc2626', fontSize: 12.5, margin: 0 }}>{error}</p>}
        {notice && <p style={{ color: '#166534', fontSize: 12.5, margin: 0 }}>{notice}</p>}

        <button type="submit" disabled={busy}
          style={{ marginTop: 6, padding: '11px 14px', borderRadius: 10, border: 'none', background: 'var(--primary-600, #1f5e3a)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Saving…' : 'Set password & continue'}
        </button>
      </form>
    </div>
  );
}

const card: React.CSSProperties = {
  width: 360, padding: 32, borderRadius: 16, background: 'var(--surface, #fff)',
  border: '1px solid var(--line-200, #e6e8e3)', boxShadow: '0 8px 30px rgba(0,0,0,0.06)',
  display: 'flex', flexDirection: 'column', gap: 14,
};
const inputStyle: React.CSSProperties = {
  width: '100%', marginTop: 6, padding: '10px 12px', borderRadius: 10,
  border: '1px solid var(--line-200, #d8dad4)', fontSize: 14, fontWeight: 400,
};
