'use client';

import { useApp } from './Providers';
import { NAV_TABS, AUDIENCES } from '@/lib/nav';

export function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={on} title={on ? 'Visible' : 'Hidden'}
      style={{
        width: 40, height: 23, borderRadius: 999, border: 'none', cursor: 'pointer', padding: 2,
        background: on ? 'var(--pkp-primary)' : 'var(--cream-400)', transition: 'background .15s ease',
        display: 'inline-flex', justifyContent: on ? 'flex-end' : 'flex-start',
      }}>
      <span style={{ width: 19, height: 19, borderRadius: '50%', background: '#fff', display: 'block' }} />
    </button>
  );
}

export function AccessScreen() {
  const { isAdmin, tabAccess, toggleTab } = useApp();

  if (!isAdmin) {
    return (
      <div className="pkp-card" style={{ padding: 40, textAlign: 'center' }}>
        <div className="pkp-h3" style={{ marginBottom: 6 }}>Admins only</div>
        <div style={{ fontSize: 13.5, color: 'var(--ink-500)' }}>
          Tab access is managed by the President &amp; VP. Switch to the Admin view to edit it.
        </div>
      </div>
    );
  }

  const cols = `1.6fr repeat(${AUDIENCES.length}, 1fr)`;
  return (
    <div className="pkp-card" style={{ padding: 22 }}>
      <h3 className="pkp-h3">Tab access</h3>
      <div style={{ fontSize: 13, color: 'var(--ink-500)', marginTop: 4, marginBottom: 18 }}>
        Choose which tabs each group can open. Admins always see everything.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, alignItems: 'center', paddingBottom: 10 }}>
        <span />
        {AUDIENCES.map((a) => (
          <span key={a.id} className="pkp-col-head" style={{ textAlign: 'center' }}>{a.label}</span>
        ))}
      </div>

      {NAV_TABS.map((t) => (
        <div key={t.href}
          style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--cream-200)' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-900)' }}>{t.label}</span>
          {AUDIENCES.map((a) => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'center' }}>
              {t.locked
                ? <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ink-400)' }}>Always</span>
                : <Switch on={!!tabAccess[a.id][t.href]} onClick={() => toggleTab(a.id, t.href)} />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
