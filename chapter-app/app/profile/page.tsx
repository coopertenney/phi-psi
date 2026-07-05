import { redirect } from 'next/navigation';

// Profile is no longer a standalone tab/page — it opens as a popup from the
// avatar in the topbar (see AppShell → ProfileDialog). Any stale link or
// bookmark to /profile lands back on the dashboard.
export default function ProfilePage() {
  redirect('/dashboard');
}
