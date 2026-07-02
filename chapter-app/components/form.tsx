'use client';

import { useEffect, type ReactNode, type CSSProperties } from 'react';

/* Shared form primitives — a centered modal dialog + labeled inputs, built on the
   same design tokens as the drawers. Used by the Add/Edit forms across screens. */

const fieldBase: CSSProperties = {
  width: '100%', border: '1px solid var(--cream-400)', borderRadius: 'var(--radius-md)',
  background: 'var(--white)', padding: '9px 11px', fontSize: 13.5, color: 'var(--ink-800)',
  fontFamily: 'var(--font-sans)', outline: 'none',
};

export function Modal({ title, sub, onClose, children, footer, width = 460 }: {
  title: string; sub?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <>
      <div className="pkp-scrim" onClick={onClose} />
      <div role="dialog" aria-modal style={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width, maxWidth: '92%', maxHeight: '88%', background: 'var(--cream-50)',
        border: '1px solid var(--cream-400)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)',
        zIndex: 42, display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--cream-300)', display: 'flex', alignItems: 'flex-start', gap: 12, background: 'var(--white)', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0' }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 19, fontWeight: 600, color: 'var(--ink-900)' }}>{title}</h2>
            {sub && <div style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 3 }}>{sub}</div>}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--cream-400)', background: 'var(--white)', color: 'var(--ink-500)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: 22, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
        {footer && (
          <div style={{ padding: '14px 22px', borderTop: '1px solid var(--cream-300)', background: 'var(--white)', display: 'flex', gap: 10, justifyContent: 'flex-end', borderRadius: '0 0 var(--radius-lg) var(--radius-lg)' }}>{footer}</div>
        )}
      </div>
    </>
  );
}

export function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-600)' }}>{label}</span>
      <input style={fieldBase} {...props} />
    </label>
  );
}

export function TextArea({ label, ...props }: { label: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-600)' }}>{label}</span>
      <textarea style={{ ...fieldBase, minHeight: 70, resize: 'vertical' }} {...props} />
    </label>
  );
}

export function Select({ label, options, ...props }: {
  label: string; options: { value: string; label: string }[];
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-600)' }}>{label}</span>
      <select style={fieldBase} {...props}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function FieldRow({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 12 }}>{children}</div>;
}

export function Checkbox({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, color: 'var(--ink-700)', cursor: 'pointer' }}>
      <input type="checkbox" style={{ width: 16, height: 16, accentColor: 'var(--pkp-primary)' }} {...props} />
      {label}
    </label>
  );
}

// Parses CSV text into a matrix of trimmed string cells. Handles quoted fields
// with embedded commas, escaped quotes ("") and newlines; skips blank lines.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const pushCell = () => { row.push(cell.trim()); cell = ''; };
  const pushRow = () => { pushCell(); if (row.some((c) => c !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') pushCell();
    else if (ch === '\n') pushRow();
    else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) pushRow();
  return rows;
}

// Triggers a client-side CSV download. Real behavior, no backend needed.
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
