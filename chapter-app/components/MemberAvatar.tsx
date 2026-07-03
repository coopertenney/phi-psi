'use client';

import { Avatar } from './ui';

// Renders a member's uploaded photo when present, else falls back to the initials
// Avatar. Kept separate from ui.Avatar so image support can be added without
// touching every initials-only call site.
export function MemberAvatar({ name, src, size = 36, fontSize }: {
  name: string; src?: string | null; size?: number; fontSize?: number;
}) {
  if (src) {
    return (
      <img
        className="pkp-avatar" src={src} alt={name}
        width={size} height={size}
        style={{ width: size, height: size, objectFit: 'cover', display: 'block' }}
      />
    );
  }
  return <Avatar name={name} size={size} fontSize={fontSize} />;
}
