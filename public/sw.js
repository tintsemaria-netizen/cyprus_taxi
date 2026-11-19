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

// Ride-share proposals (2026-11-19): «Нашёлся попутчик» must reach the passenger / driver even
// when the app is closed or the phone is locked — shown in the app's language, kept on screen
// until answered, with sound and vibration. Server formats: src/server/share.ts proposalBody /
// driverProposalBody. (iPhone: only when the site is added to the Home Screen — Apple's rule.)
const SHARE_TEXT = {
  ru: { p: 'Нашёлся попутчик', d: 'Попутчик по пути', who: (a, c, l) => `взрослых: ${a}${c ? `, детей: ${c}` : ''}, чемоданов: ${l}`, longer: (n) => (n > 0 ? `+${n} мин` : 'время почти то же'), cheaper: (e) => `дешевле на ${e}`, instead: (now, was) => `${now} вместо ${was}`, tap: 'нажмите, чтобы ответить' },
  en: { p: 'A co-rider for your ride', d: 'Co-rider on your route', who: (a, c, l) => `${a} adult(s)${c ? `, ${c} child(ren)` : ''}, ${l} suitcase(s)`, longer: (n) => (n > 0 ? `+${n} min` : 'about the same time'), cheaper: (e) => `${e} cheaper`, instead: (now, was) => `${now} instead of ${was}`, tap: 'tap to answer' },
  el: { p: 'Βρέθηκε συνεπιβάτης', d: 'Συνεπιβάτης στη διαδρομή', who: (a, c, l) => `ενήλικες: ${a}${c ? `, παιδιά: ${c}` : ''}, βαλίτσες: ${l}`, longer: (n) => (n > 0 ? `+${n} λεπ.` : 'σχεδόν ίδιος χρόνος'), cheaper: (e) => `${e} φθηνότερα`, instead: (now, was) => `${now} αντί ${was}`, tap: 'πατήστε για απάντηση' },
  de: { p: 'Ein Mitfahrer für Ihre Fahrt', d: 'Mitfahrer auf Ihrer Strecke', who: (a, c, l) => `Erwachsene: ${a}${c ? `, Kinder: ${c}` : ''}, Koffer: ${l}`, longer: (n) => (n > 0 ? `+${n} Min.` : 'etwa gleich lang'), cheaper: (e) => `${e} günstiger`, instead: (now, was) => `${now} statt ${was}`, tap: 'zum Antworten tippen' },
  fr: { p: 'Un covoyageur pour votre trajet', d: 'Covoyageur sur votre trajet', who: (a, c, l) => `adultes : ${a}${c ? `, enfants : ${c}` : ''}, valises : ${l}`, longer: (n) => (n > 0 ? `+${n} min` : 'à peu près pareil'), cheaper: (e) => `${e} de moins`, instead: (now, was) => `${now} au lieu de ${was}`, tap: 'touchez pour répondre' },
  pl: { p: 'Współpasażer do Twojego przejazdu', d: 'Współpasażer na trasie', who: (a, c, l) => `dorośli: ${a}${c ? `, dzieci: ${c}` : ''}, walizki: ${l}`, longer: (n) => (n > 0 ? `+${n} min` : 'mniej więcej tyle samo'), cheaper: (e) => `taniej o ${e}`, instead: (now, was) => `${now} zamiast ${was}`, tap: 'stuknij, aby odpowiedzieć' },
  he: { p: 'נמצא נוסע משותף', d: 'נוסע משותף במסלול', who: (a, c, l) => `מבוגרים: ${a}${c ? `, ילדים: ${c}` : ''}, מזוודות: ${l}`, longer: (n) => (n > 0 ? `+${n} דק׳` : 'כמעט אותו זמן'), cheaper: (e) => `זול ב־${e}`, instead: (now, was) => `${now} במקום ${was}`, tap: 'הקישו כדי לענות' },
  ar: { p: 'وُجد راكب مشارك', d: 'راكب مشارك على مسارك', who: (a, c, l) => `بالغون: ${a}${c ? `، أطفال: ${c}` : ''}، حقائب: ${l}`, longer: (n) => (n > 0 ? `+${n} د` : 'نفس المدة تقريباً'), cheaper: (e) => `أرخص بـ ${e}`, instead: (now, was) => `${now} بدلاً من ${was}`, tap: 'اضغط للرد' },
};
function shareText(tag, body, L) {
  const S = SHARE_TEXT[L] || SHARE_TEXT.en;
  if (tag.startsWith('share-p-')) {
    const m = /^(\d+) adults?(?:, (\d+) child(?:ren)?)?, (\d+) suitcases? · \+(\d+) min · €([\d.]+) cheaper — tap to answer$/.exec(body || '');
    if (!m) return null;
    return { title: `👥 ${S.p}`, body: `${S.who(m[1], Number(m[2] || 0), m[3])} · ${S.longer(Number(m[4]))} · ${S.cheaper(`€${m[5]}`)} — ${S.tap}` };
  }
  if (tag.startsWith('share-d-')) {
    const m = /^\+(\d+) min · €([\d.]+) instead of €([\d.]+) — tap to answer$/.exec(body || '');
    if (!m) return null;
    return { title: `👥 ${S.d}`, body: `${S.longer(Number(m[1]))} · ${S.instead(`€${m[2]}`, `€${m[3]}`)} — ${S.tap}` };
  }
  return null;
}

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
  const isShare = typeof data.tag === 'string' && (data.tag.startsWith('share-p-') || data.tag.startsWith('share-d-'));
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
    if (isShare) {
      const st = shareText(data.tag, body, await appLocale());
      if (st) { title = st.title; body = st.body; }
    }
    await self.registration.showNotification(title, {
      body,
      tag: data.tag,
      renotify: true,
      silent: false,
      requireInteraction: isOffer || isShare, // stays until the person acts on it
      vibrate: isOffer || isShare ? [600, 200, 600, 200, 600, 200, 600] : [200],
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
