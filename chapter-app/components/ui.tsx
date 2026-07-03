import type { ReactNode } from 'react';
import { initials, tint, type BadgeTone } from '@/lib/format';
import { icons } from './icons';

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
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols},1fr)`, gap: 16 }}>
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
