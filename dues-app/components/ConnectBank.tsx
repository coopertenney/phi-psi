'use client';

import Script from 'next/script';
import { useState } from 'react';

// Plaid Link is a CDN script, so the button stays disabled until onLoad fires —
// window.Plaid does not exist before then.

declare global {
  interface Window {
    Plaid?: {
      create(config: {
        token: string;
        onSuccess: (publicToken: string) => void;
        onExit: (err: unknown) => void;
      }): { open(): void };
    };
  }
}

export function ConnectBank({ mode }: { mode: 'connect' | 'reconnect' }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ingestFrom, setIngestFrom] = useState(() => new Date().toISOString().slice(0, 10));

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/plaid/link-token', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not start the bank connection.');
      if (!window.Plaid) throw new Error('The bank connection script did not load.');

      window.Plaid.create({
        token: body.linkToken,
        onSuccess: async (publicToken: string) => {
          // Two verbs, two endpoints. Reconnecting must never reach /exchange —
          // that path stores a NEW Item, and Plaid's lifetime cap does not
          // refund the old one.
          const url = mode === 'reconnect' ? '/api/plaid/reconnected' : '/api/plaid/exchange';
          const finish = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ publicToken, ingestFrom }),
          });
          const done = await finish.json();
          if (!finish.ok) { setError(done.error ?? 'Could not finish connecting.'); setBusy(false); return; }
          window.location.href = '/bank?ok=Bank+connected.';
        },
        onExit: () => setBusy(false),
      }).open();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the bank connection.');
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <Script
        src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"
        strategy="afterInteractive"
        onLoad={() => setReady(true)}
      />
      <h3>{mode === 'reconnect' ? 'Reconnect the bank' : 'Connect the chapter account'}</h3>

      {mode === 'connect' && (
        <label className="mapfield">
          Start counting payments from
          <input
            type="date"
            value={ingestFrom}
            onChange={(e) => setIngestFrom(e.target.value)}
          />
          <span className="maphint">
            Usually the first day of the term. Credits older than this are ignored — they
            have no charge to match against, so they would arrive as a queue full of rows
            to dismiss by hand.
          </span>
        </label>
      )}

      <p className="note">
        {mode === 'reconnect'
          ? 'Signs in to the bank again and keeps the existing connection. Your place in the transaction history is preserved, so nothing is re-imported.'
          : 'You sign in at Stanford FCU inside the bank’s own window. No password is ever seen by this app.'}
      </p>

      {error && <p className="err">{error}</p>}

      <button className="btn-primary" type="button" onClick={open} disabled={!ready || busy}>
        {busy ? 'Waiting for the bank…' : ready
          ? (mode === 'reconnect' ? 'Reconnect' : 'Connect the chapter account')
          : 'Loading…'}
      </button>
    </div>
  );
}
