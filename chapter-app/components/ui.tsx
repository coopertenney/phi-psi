import type { ReactNode } from 'react';
import { initials, tint, type BadgeTone } from '@/lib/format';

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
