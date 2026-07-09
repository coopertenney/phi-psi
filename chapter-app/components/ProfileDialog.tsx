'use client';

import type { MemberRow } from '@/lib/types';
import { ProfileScreen } from './ProfileScreen';
import { useEscapeKey } from './useEscapeKey';

// The signed-in member's profile, shown as a centered popup instead of a nav tab.
// Wraps the full ProfileScreen in a scrim + scrollable panel. Opened from the
// avatar in the topbar (and the account block in the mobile drawer).
export function ProfileDialog({ members, myMembershipId, live = false, onClose }: {
  members: MemberRow[];
  myMembershipId: string | null;
  live?: boolean;
  onClose: () => void;
}) {
  useEscapeKey(onClose);

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Your profile"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(20,20,19,.42)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: 'clamp(16px, 5vh, 56px) 16px', overflowY: 'auto',
        animation: 'pkpScrim .2s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', width: '100%', maxWidth: 960,
          background: 'var(--cream-50)', border: '1px solid var(--cream-400)',
          borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)',
          padding: 'clamp(18px, 3vw, 28px)',
          animation: 'pkpSlide .28s cubic-bezier(.16,1,.3,1)',
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute', top: 16, right: 16, zIndex: 1,
            width: 34, height: 34, borderRadius: '50%', border: '1px solid var(--cream-400)',
            background: 'var(--white)', color: 'var(--ink-500)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
          }}
        >
          ✕
        </button>
        <ProfileScreen members={members} myMembershipId={myMembershipId} live={live} />
      </div>
    </div>
  );
}
