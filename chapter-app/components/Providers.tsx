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
  tabAccess: TabAccess;
  toggleTab: (audience: Audience, href: string) => void;
};
const AppContext = createContext<Ctx | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within <Providers>');
  return ctx;
}

export function Providers({ children }: { children: React.ReactNode }) {
  // Default to admin so the access-control feature is discoverable on first load.
  const [persona, setPersona] = useState<Persona>('admin');
  const [tabAccess, setTabAccess] = useState<TabAccess>(defaultTabAccess);
  const [loaded, setLoaded] = useState(false);

  // Restore persisted prefs once on mount.
  useEffect(() => {
    const p = localStorage.getItem('pkp-persona') as Persona | null;
    const a = localStorage.getItem('pkp-tab-access');
    if (p) setPersona(p);
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
  }, []);

  // Lock the visual theme on <html>.
  useEffect(() => { document.documentElement.dataset.theme = THEME; }, []);

  // Persist only *after* the initial restore — otherwise the default values
  // overwrite stored prefs on a fresh mount (the bug that reset the toggle).
  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem('pkp-persona', persona);
    localStorage.setItem('pkp-tab-access', JSON.stringify(tabAccess));
  }, [loaded, persona, tabAccess]);

  const toggleTab = (audience: Audience, href: string) =>
    setTabAccess((prev) => ({
      ...prev,
      [audience]: { ...prev[audience], [href]: !prev[audience][href] },
    }));

  const value: Ctx = {
    persona, setPersona,
    role: roleFor(persona),
    isAdmin: persona === 'admin',
    tabAccess, toggleTab,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
