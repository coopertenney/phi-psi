'use client';

import type { CSSProperties, FormEvent, ReactNode } from 'react';

// The centered card shared by the login and set-password pages: the chapter
// brand header on top, the page's own fields/buttons as children. The `<form>`
// is the card itself (matching both pages' original markup).
const card: CSSProperties = {
  width: 360, padding: 32, borderRadius: 16, background: 'var(--surface, #fff)',
  border: '1px solid var(--line-200, #e6e8e3)', boxShadow: '0 8px 30px rgba(0,0,0,0.06)',
  display: 'flex', flexDirection: 'column', gap: 14,
};

export const authInputStyle: CSSProperties = {
  width: '100%', marginTop: 6, padding: '10px 12px', borderRadius: 10,
  border: '1px solid var(--line-200, #d8dad4)', fontSize: 14, fontWeight: 400,
};

export function AuthCard({ onSubmit, children }: { onSubmit: (e: FormEvent) => void; children: ReactNode }) {
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
        {children}
      </form>
    </div>
  );
}
