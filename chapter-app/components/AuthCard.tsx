'use client';

import type { CSSProperties, FormEvent, ReactNode } from 'react';

// Shared frame for the login + set-password pages: a heritage split-screen —
// the chapter brand panel on the left, the page's own fields/buttons (children)
// in the form card on the right. The <form> is the card itself.
export const authInputStyle: CSSProperties = {
  width: '100%', marginTop: 6, padding: '10px 12px', borderRadius: 9,
  border: '1px solid var(--cream-400)', background: 'var(--white)',
  fontSize: 14, fontWeight: 400, color: 'var(--ink-800)', outline: 'none',
};

export function AuthCard({ onSubmit, children }: { onSubmit: (e: FormEvent) => void; children: ReactNode }) {
  return (
    <div className="pkp-auth">
      <aside className="pkp-auth-brand">
        <div className="pkp-auth-wordmark">
          <img className="pkp-auth-crest" src="/crest.png" alt="Phi Kappa Psi coat of arms" />
          <div className="pkp-auth-name">Phi Kappa Psi</div>
          <div className="pkp-auth-rule" />
          <div className="pkp-auth-chapter">California Beta Chapter · Stanford University</div>
        </div>
        <div className="pkp-auth-tag">
          <div className="pkp-auth-motto">“The great joy of serving others.”</div>
          <div className="pkp-auth-est">Founded 1852 · Jefferson College</div>
        </div>
      </aside>

      <div className="pkp-auth-panel">
        <form onSubmit={onSubmit} className="pkp-auth-card">
          {children}
        </form>
      </div>
    </div>
  );
}
