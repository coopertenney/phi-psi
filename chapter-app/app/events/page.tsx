import { redirect } from 'next/navigation';

// Events was renamed to Socials (and narrowed to social/brotherhood events).
// Keep this permanent redirect so old links, bookmarks, and any lingering
// /events references land on the new tab.
export default function EventsPage() {
  redirect('/socials');
}
