'use client';

import { useEffect, useState, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeKey } from './useEscapeKey';

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
  // Portal to <body> so the fixed overlay escapes the main content's stacking
  // context (z-index:1) — otherwise it renders *below* the topbar (z-index:5)
  // and tall modals get clipped by the header bar. Mount-gated to avoid an SSR
  // hydration mismatch (document isn't available on the server).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEscapeKey(onClose);

  if (!mounted) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(20,20,19,.42)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'clamp(16px, 4vh, 40px) 16px', animation: 'pkpScrim .2s ease',
      }}
    >
      <div role="dialog" aria-modal onClick={(e) => e.stopPropagation()} style={{
        width, maxWidth: '94%', maxHeight: '92vh', background: 'var(--cream-50)',
        border: '1px solid var(--cream-400)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)',
        display: 'flex', flexDirection: 'column',
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
    </div>,
    document.body,
  );
}

// The Cancel / primary-action pair used in every modal's `footer`. `canSave`
// drives the primary button's enabled/dimmed state (defaults to always-on).
export function ModalActions({ onCancel, onSave, saveLabel, canSave = true, cancelLabel = 'Cancel' }: {
  onCancel: () => void; onSave: () => void; saveLabel: ReactNode; canSave?: boolean; cancelLabel?: string;
}) {
  return (
    <>
      <button className="pkp-btn-ghost" style={{ height: 38, padding: '0 16px', fontSize: 13.5 }} onClick={onCancel}>{cancelLabel}</button>
      <button className="pkp-btn-primary" style={{ height: 38, padding: '0 18px', fontSize: 13.5, opacity: canSave ? 1 : 0.5, cursor: canSave ? 'pointer' : 'not-allowed' }} disabled={!canSave} onClick={onSave}>
        {saveLabel}
      </button>
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
