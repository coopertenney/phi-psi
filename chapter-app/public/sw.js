/* Phi Kappa Psi — service worker (Web Push).
 *
 * Served from the site root so its scope is the whole app. It has one job:
 * receive push messages and turn them into OS notifications, then focus/open the
 * app when one is tapped. It deliberately does NOT cache anything — offline
 * support is out of scope; this is push only.
 *
 * The server sends a JSON payload { title, body, url, tag }; we fall back to
 * sensible defaults if a push arrives with no/na malformed data. */

self.addEventListener('install', () => {
  // Activate this worker immediately instead of waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of already-open clients so the first push works without reload.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }

  // Fallback only — every payload we send sets its own title. Kept off the
  // chapter name so it doesn't read as "Phi Kappa Psi from Phi Psi" (the OS
  // already appends "from Phi Psi", the installed app's name).
  const title = data.title || 'Chapter update';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'pkp-notification',
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an existing tab if the app is already open; otherwise open one.
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
