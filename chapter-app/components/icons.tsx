import type { ReactNode } from 'react';

// SVG icon set ported from the prototype's _icon().
const Svg = ({ size = 18, children }: { size?: number; children: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

export const icons = {
  dashboard: (
    <Svg><rect x={3} y={3} width={7} height={8} rx={2} /><rect x={14} y={3} width={7} height={5} rx={2} /><rect x={14} y={12} width={7} height={9} rx={2} /><rect x={3} y={14} width={7} height={7} rx={2} /></Svg>
  ),
  members: (
    <Svg><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx={9} cy={7} r={4} /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Svg>
  ),
  finances: (
    <Svg><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></Svg>
  ),
  events: (
    <Svg><rect x={3} y={4} width={18} height={18} rx={2} /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></Svg>
  ),
  attendance: (
    <Svg><path d="m9 11 3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></Svg>
  ),
  points: (
    <Svg><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></Svg>
  ),
  announcements: (
    <Svg><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></Svg>
  ),
  recruitment: (
    <Svg><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx={9} cy={7} r={4} /><path d="M19 8v6" /><path d="M22 11h-6" /></Svg>
  ),
  access: (
    <Svg><path d="M12 2 4 5v6c0 5 3.4 8.2 8 9 4.6-.8 8-4 8-9V5l-8-3Z" /><path d="m9 12 2 2 4-4" /></Svg>
  ),
  files: (
    <Svg><path d="M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-8l-2-2H4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1Z" /></Svg>
  ),
  search: (<Svg size={16}><circle cx={11} cy={11} r={8} /><path d="m21 21-4.3-4.3" /></Svg>),
  plus: (<Svg size={16}><path d="M5 12h14" /><path d="M12 5v14" /></Svg>),
  chevron: (<Svg size={18}><path d="m9 18 6-6-6-6" /></Svg>),
};

export type IconName = keyof typeof icons;
