'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import {
  type Persona, type Audience, type TabAccess, roleFor, defaultTabAccess,
} from '@/lib/nav';

// The chapter is locked to the Hunter scheme (green primary + crest accent).
const THEME = 'hunter';

type Ctx = {
  persona: Persona; setPersona: (p: Persona) => void;
  role: 'exec' | 'member';
  isAdmin: boolean;
  canSwitchPersona: boolean;
  tabAccess: TabAccess;
  toggleTab: (audience: Audience, href: string) => void;
};
const AppContext = createContext<Ctx | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within <Providers>');
  return ctx;
}

export function Providers({ signedInPersona = null, children }: {
  signedInPersona?: Persona | null;
  children: React.ReactNode;
}) {
  // A real signed-in user's role is authoritative — it drives the sidebar so a
  // member never inherits a stale `admin` from localStorage. Only in mock/demo
  // mode (no signed-in user) do we default to admin so the access-control
  // feature stays discoverable and the "view as" switcher persists.
  const [persona, setPersona] = useState<Persona>(signedInPersona ?? 'admin');
  const [tabAccess, setTabAccess] = useState<TabAccess>(defaultTabAccess);
  const [loaded, setLoaded] = useState(false);
  // Only the demo (no real user) or a real admin may "view as" another persona;
  // a real member can't switch back into admin/exec tabs.
  const canSwitchPersona = signedInPersona === null || signedInPersona === 'admin';

  // Restore persisted prefs once on mount.
  useEffect(() => {
    // Persona is restored from localStorage only in demo mode. For a real
    // signed-in user their role already seeded it and must win over any cache.
    const p = localStorage.getItem('pkp-persona') as Persona | null;
    const a = localStorage.getItem('pkp-tab-access');
    if (p && signedInPersona === null) setPersona(p);
    if (a) {
      // Merge stored access *over* the defaults so a tab/audience added later
      // doesn't read back undefined (which would hide it).
      try {
        const stored = JSON.parse(a) as Partial<TabAccess>;
        const base = defaultTabAccess();
        setTabAccess({
          exec: { ...base.exec, ...stored.exec },
          member: { ...base.member, ...stored.member },
          new: { ...base.new, ...stored.new },
        });
      } catch { /* keep defaults */ }
    }
    setLoaded(true);
  }, [signedInPersona]);

  // Lock the visual theme on <html>.
  useEffect(() => { document.documentElement.dataset.theme = THEME; }, []);

  // Persist only *after* the initial restore — otherwise the default values
  // overwrite stored prefs on a fresh mount (the bug that reset the toggle).
  // Persona is persisted only in demo mode; a real user's persona comes from
  // their role each load, so caching it would just risk masking a role change.
  useEffect(() => {
    if (!loaded) return;
    if (signedInPersona === null) localStorage.setItem('pkp-persona', persona);
    localStorage.setItem('pkp-tab-access', JSON.stringify(tabAccess));
  }, [loaded, persona, tabAccess, signedInPersona]);

  const toggleTab = (audience: Audience, href: string) =>
    setTabAccess((prev) => ({
      ...prev,
      [audience]: { ...prev[audience], [href]: !prev[audience][href] },
    }));

  const value: Ctx = {
    persona, setPersona,
    role: roleFor(persona),
    isAdmin: persona === 'admin',
    canSwitchPersona,
    tabAccess, toggleTab,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
