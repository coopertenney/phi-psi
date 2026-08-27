import { signOut } from '@/app/login/actions';

const TABS = [
  { href: '/', label: 'Desk' },
  { href: '/settings', label: 'Term & charges' },
  { href: '/balances', label: 'Member view' },
];

export function Nav({ active, showSignOut }: { active: string; showSignOut: boolean }) {
  return (
    <nav className="tabs">
      {TABS.map((t) => (
        <a key={t.href} href={t.href} className={t.href === active ? 'active' : undefined}>{t.label}</a>
      ))}
      {showSignOut && (
        <form action={signOut}>
          <button className="btn-quiet" type="submit">Sign out</button>
        </form>
      )}
    </nav>
  );
}
