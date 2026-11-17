/* IL-Y service worker — Web Push notifications (ride offers, chat, ride updates).
   Notifications supplement the in-app polling; they are best-effort. */

// Ride offers (2026-11-15): while the driver is in ANOTHER app the offer arrives as a heads-up
// banner from the top, with the system sound and a long vibration, in the driver's language.
// It closes itself when the offer expires so a stale offer is never left on screen.
const OFFER_TTL_MS = 12000; // offer lifetime (10 s) + delivery slack

const OFFER_TEXT = {
  ru: { title: 'Новый заказ', min: (n) => `~${n} мин до клиента`, tap: 'нажмите, чтобы открыть', near: 'Клиент рядом' },
  el: { title: 'Νέα κούρσα', min: (n) => `~${n} λεπτά μέχρι τον πελάτη`, tap: 'πατήστε για άνοιγμα', near: 'Πελάτης κοντά' },
  en: { title: 'New ride offer', min: (n) => `~${n} min to the pickup`, tap: 'tap to open', near: 'Pickup nearby' },
  he: { title: 'הזמנה חדשה', min: (n) => `~${n} דק׳ עד הלקוח`, tap: 'הקישו לפתיחה', near: 'הלקוח קרוב' },
  ar: { title: 'طلب جديد', min: (n) => `~${n} د حتى العميل`, tap: 'اضغط للفتح', near: 'العميل قريب' },
  pl: { title: 'Nowe zlecenie', min: (n) => `~${n} min do klienta`, tap: 'stuknij, aby otworzyć', near: 'Klient w pobliżu' },
  de: { title: 'Neuer Auftrag', min: (n) => `~${n} Min. bis zum Kunden`, tap: 'zum Öffnen tippen', near: 'Kunde in der Nähe' },
  fr: { title: 'Nouvelle course', min: (n) => `~${n} min jusqu’au client`, tap: 'touchez pour ouvrir', near: 'Client à proximité' },
};

async function appLocale() {
  try {
    const c = await caches.open('ily-prefs');
    const r = await c.match('/__ily-locale');
    if (r) { const l = (await r.text()).trim(); if (OFFER_TEXT[l]) return l; }
  } catch (_e) { /* ignore */ }
  const nav = (self.navigator && self.navigator.language || 'en').slice(0, 2);
  return OFFER_TEXT[nav] ? nav : 'en';
}

// The server's offer body is "<pickup> · ~N min away — tap to accept" (src/server/push.ts offerBody).
function parseOfferBody(body) {
  const m = /^(.*?)(?: · ~(\d+) min away)? — tap to accept$/.exec(body || '');
  return m ? { pickup: m[1], min: m[2] ? Number(m[2]) : null } : { pickup: body || '', min: null };
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_e) { data = {}; }
  const isOffer = data.tag === 'offer';
  event.waitUntil((async () => {
    const shownAt = Date.now();
    let title = data.title || 'IL-Y';
    let body = data.body || '';
    if (isOffer) {
      const L = OFFER_TEXT[await appLocale()];
      const p = parseOfferBody(body);
      const pickup = p.pickup && p.pickup !== 'Pickup nearby' ? p.pickup : L.near;
      title = `🚕 ${L.title}`;
      body = `${pickup}${p.min != null ? ` · ${L.min(p.min)}` : ''} — ${L.tap}`;
    }
    await self.registration.showNotification(title, {
      body,
      tag: data.tag,
      renotify: true,
      silent: false,
      requireInteraction: isOffer,
      vibrate: isOffer ? [600, 200, 600, 200, 600, 200, 600] : [200],
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-32.png',
      timestamp: Date.now(),
      data: { url: data.url || '/', shownAt },
    });
    if (isOffer) {
      // Remove the banner once the offer can no longer be accepted.
      await new Promise((r) => setTimeout(r, OFFER_TTL_MS));
      const list = await self.registration.getNotifications({ tag: 'offer' });
      list.forEach((n) => { if (n.data && n.data.shownAt === shownAt) n.close(); }); // not a newer offer
    }
  })());
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
