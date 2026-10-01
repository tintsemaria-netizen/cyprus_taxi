/* IL-Y service worker — Web Push notifications (chat). Notifications supplement the
   in-app polling; they are best-effort. */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_e) { data = {}; }
  const title = data.title || 'IL-Y';
  // A ride offer lives ~20 s: keep it on screen until acted on, and vibrate (audit 2026-10-01).
  const isOffer = data.tag === 'offer';
  const options = {
    body: data.body || '',
    tag: data.tag,
    renotify: true,
    requireInteraction: isOffer,
    vibrate: isOffer ? [300, 150, 300, 150, 300] : [200],
    icon: '/icons/icon-192.png',
    badge: '/icons/favicon-32.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(url) && 'focus' in w) return w.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
