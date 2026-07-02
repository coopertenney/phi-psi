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
