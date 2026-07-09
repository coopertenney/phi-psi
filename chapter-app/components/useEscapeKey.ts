import { useEffect } from 'react';

// Closes a popup (modal, drawer, dialog) when Escape is pressed. Every overlay
// primitive calls this so ESC works consistently everywhere in the app.
// `enabled` lets a caller opt out (e.g. a confirmation step that shouldn't be
// dismissable); defaults to on.
export function useEscapeKey(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, enabled]);
}
