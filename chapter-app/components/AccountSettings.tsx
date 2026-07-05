'use client';

import { useState } from 'react';
import { getBrowserSupabase, isSupabaseConfigured } from '@/lib/supabase/browser';
import { Field } from './form';

// The signed-in member's account settings — currently just a password change.
// Renders nothing in mock mode (no real auth to change).
export function AccountSettings() {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  if (!isSupabaseConfigured) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(false);
    if (newPassword.length < 6) return setErr('Password must be at least 6 characters.');
    if (newPassword !== confirm) return setErr('Passwords don’t match.');
    setBusy(true);
    const { error } = await getBrowserSupabase().auth.updateUser({ password: newPassword });
    setBusy(false);
    if (error) return setErr(error.message);
    setNewPassword('');
    setConfirm('');
    setOk(true);
  }

  return (
    <div className="pkp-card" style={{ padding: 22 }}>
      <h3 className="pkp-h3" style={{ marginBottom: 6 }}>Settings</h3>
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 320, marginTop: 10 }}>
        <Field label="New password" type="password" minLength={6} autoComplete="new-password"
          value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <Field label="Confirm new password" type="password" minLength={6} autoComplete="new-password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {err && <p style={{ color: 'var(--danger-600, #dc2626)', fontSize: 12.5, margin: 0 }}>{err}</p>}
        {ok && <p style={{ color: 'var(--success-600, #16a34a)', fontSize: 12.5, margin: 0 }}>Password updated.</p>}
        <button type="submit" className="pkp-btn-primary" disabled={busy} style={{ height: 38, padding: '0 16px', fontSize: 13.5, alignSelf: 'flex-start', opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}
