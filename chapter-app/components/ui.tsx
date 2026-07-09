'use client';

import type { CSSProperties, ReactNode } from 'react';
import { initials, tint, type BadgeTone } from '@/lib/format';
import { icons } from './icons';
import { useEscapeKey } from './useEscapeKey';

export function Avatar({ name, size = 36, fontSize }: { name: string; size?: number; fontSize?: number }) {
  const t = tint(name);
  return (
    <div className="pkp-avatar" style={{ width: size, height: size, fontSize: fontSize ?? size / 2.7, background: t.bg, color: t.fg }}>
      {initials(name)}
    </div>
  );
}

export function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return <span className={`pkp-badge ${tone}`}>{children}</span>;
}

// The slide-in detail drawer shared by every screen: scrim + panel, a header
// row (caller supplies the leader/title as `header`; the ✕ is built in), a
// scrolling body (children), and an optional footer. `headerGap`/`bodyGap`
// carry the small per-screen spacing differences.
export function Drawer({ onClose, header, footer, headerGap = 16, bodyGap = 18, children }: {
  onClose: () => void; header: ReactNode; footer?: ReactNode; headerGap?: number; bodyGap?: number; children: ReactNode;
}) {
  useEscapeKey(onClose);
  return (
    <>
      <div className="pkp-scrim" onClick={onClose} />
      <div className="pkp-drawer">
        <div style={{ padding: 22, borderBottom: '1px solid var(--cream-300)', display: 'flex', alignItems: 'flex-start', gap: headerGap, background: 'var(--white)' }}>
          {header}
          <CloseButton onClose={onClose} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: bodyGap }}>
          {children}
        </div>
        {footer && (
          <div style={{ padding: '16px 22px', borderTop: '1px solid var(--cream-300)', background: 'var(--white)', display: 'flex', gap: 10 }}>{footer}</div>
        )}
      </div>
    </>
  );
}

// The round ✕ that closes every detail drawer (matches the Modal's close).
export function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--cream-400)', background: 'var(--white)', color: 'var(--ink-500)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
  );
}

// The primary "＋ Add …" button that heads each roster/pipeline screen.
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="pkp-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 18px', fontSize: 13.5, boxShadow: 'var(--shadow-sm)' }} onClick={onClick}>
      <span style={{ display: 'inline-flex' }}>{icons.plus}</span>{label}
    </button>
  );
}

// Small labelled figure card (mono value + caption) used inside detail drawers.
export function MiniStat({ val, label, color }: { val: ReactNode; label: ReactNode; color?: string }) {
  return (
    <div className="pkp-card" style={{ padding: 14 }}>
      <div className="pkp-mono" style={{ fontSize: 20, fontWeight: 600, color, lineHeight: 1 }}>{val}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 6 }}>{label}</div>
    </div>
  );
}

// Filter-chip row: the `.pkp-chips` group used above every roster/pipeline table.
export function Chips<T extends string>({ options, value, onChange }: {
  options: readonly { id: T; label: string }[]; value: T; onChange: (id: T) => void;
}) {
  return (
    <div className="pkp-chips">
      {options.map((c) => (
        <button key={c.id} className={`pkp-chip${value === c.id ? ' on' : ''}`} onClick={() => onChange(c.id)}>{c.label}</button>
      ))}
    </div>
  );
}

// The 3-or-4-up summary stat row (`.pkp-stat` cards) that heads several screens.
export function StatCards({ cards, cols = 3 }: {
  cards: { val: ReactNode; label: ReactNode; sub?: ReactNode }[]; cols?: number;
}) {
  return (
    <div className="pkp-stats" style={{ '--pkp-cols': cols } as CSSProperties}>
      {cards.map((c, i) => (
        <div key={i} className="pkp-stat">
          <div className="pkp-stat-val">{c.val}</div>
          <div className="pkp-stat-label">{c.label}</div>
          <div className="pkp-stat-sub">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
