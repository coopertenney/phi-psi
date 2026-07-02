// Single source of truth for navigation + the access-control layer.
//
// `Persona` is who you're viewing the app as (topbar switcher). It layers on top
// of the existing exec/member `Role`: admin is reserved for President/VP and maps
// to exec-level *content*, but additionally sees the Access screen and bypasses
// tab-visibility rules. `Audience` is the set of governable groups whose tab
// access an admin can toggle.

export type Audience = 'exec' | 'member' | 'new';
export type Persona = 'admin' | Audience;
export type TabAccess = Record<Audience, Record<string, boolean>>;

// Topbar persona switcher (the demo "view as").
export const PERSONAS: { id: Persona; label: string }[] = [
  { id: 'admin', label: 'Admin' },
  { id: 'exec', label: 'Exec' },
  { id: 'member', label: 'Member' },
  { id: 'new', label: 'New' },
];

// Governable groups, in the order they appear as columns on the Access screen.
export const AUDIENCES: { id: Audience; label: string }[] = [
  { id: 'exec', label: 'Exec officers' },
  { id: 'member', label: 'Active members' },
  { id: 'new', label: 'New members' },
];

// The nav tabs an admin can toggle. Dashboard is locked on so a group can never
// be toggled into an empty app. `id` doubles as the icon key.
export const NAV_TABS: { href: string; id: string; label: string; locked?: boolean }[] = [
  { href: '/dashboard', id: 'dashboard', label: 'Dashboard', locked: true },
  { href: '/members', id: 'members', label: 'Members' },
  { href: '/recruitment', id: 'recruitment', label: 'Recruitment' },
  { href: '/finances', id: 'finances', label: 'Finances' },
  { href: '/events', id: 'events', label: 'Events' },
  { href: '/attendance', id: 'attendance', label: 'Attendance' },
  { href: '/points', id: 'points', label: 'Points' },
  { href: '/announcements', id: 'announcements', label: 'Announcements' },
  { href: '/files', id: 'files', label: 'Files' },
];

// admin & exec see exec-level content; member & new see the member views.
export const roleFor = (p: Persona): 'exec' | 'member' =>
  p === 'admin' || p === 'exec' ? 'exec' : 'member';

// Which governed audience a persona belongs to (admin is ungoverned → null).
export const audienceFor = (p: Persona): Audience | null => (p === 'admin' ? null : p);

// Everyone sees everything by default, except new members can't open Recruitment.
export function defaultTabAccess(): TabAccess {
  const all = (): Record<string, boolean> =>
    Object.fromEntries(NAV_TABS.map((t) => [t.href, true]));
  const access: TabAccess = { exec: all(), member: all(), new: all() };
  access.new['/recruitment'] = false;
  return access;
}
