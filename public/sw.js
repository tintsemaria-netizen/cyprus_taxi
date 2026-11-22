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

// Other notifications sent with a text key (2026-11-22, server `msg: { k, p }` — src/server/push.ts
// PushMsg): shown in the app's language, or the phone's when the app has not saved one. A key or
// language missing here → the server's English title/body. `…C` values are euro cents.
const MSG_TEXT = {
  'share.joinGuest': {
    ru: ['Водитель назначен — поездка с попутчиком', 'Вы едете с попутчиком: {nowC} вместо {wasC}.'],
    en: ['Driver assigned — shared ride', 'You share the car with a co-rider: {nowC} instead of {wasC}.'],
    el: ['Οδηγός ορίστηκε — κοινή διαδρομή', 'Μοιράζεστε το ταξί με συνεπιβάτη: {nowC} αντί {wasC}.'],
    de: ['Fahrer zugewiesen — geteilte Fahrt', 'Sie teilen das Auto mit einem Mitfahrer: {nowC} statt {wasC}.'],
    fr: ['Chauffeur attribué — trajet partagé', 'Vous partagez la voiture avec un covoyageur : {nowC} au lieu de {wasC}.'],
    pl: ['Kierowca przydzielony — wspólny przejazd', 'Jedziesz ze współpasażerem: {nowC} zamiast {wasC}.'],
    he: ['נהג שובץ — נסיעה משותפת', 'אתם חולקים את הרכב עם נוסע נוסף: {nowC} במקום {wasC}.'],
    ar: ['تم تعيين سائق — رحلة مشتركة', 'تتشارك السيارة مع راكب آخر: {nowC} بدلاً من {wasC}.'],
  },
  'share.joinHost': {
    ru: ['К вам присоединился попутчик', 'Ваша цена теперь {nowC}.'],
    en: ['Co-rider joins', 'Your price is now {nowC}.'],
    el: ['Προστέθηκε συνεπιβάτης', 'Η τιμή σας είναι τώρα {nowC}.'],
    de: ['Ein Mitfahrer steigt zu', 'Ihr Preis beträgt jetzt {nowC}.'],
    fr: ['Un covoyageur vous rejoint', 'Votre prix est maintenant de {nowC}.'],
    pl: ['Dołącza współpasażer', 'Twoja cena to teraz {nowC}.'],
    he: ['נוסע משותף מצטרף', 'המחיר שלכם עכשיו {nowC}.'],
    ar: ['انضم راكب مشارك', 'سعرك الآن {nowC}.'],
  },
  'share.confirmed': {
    ru: ['Поездка с попутчиком подтверждена', 'Ваша цена теперь {nowC}.'],
    en: ['Shared ride confirmed', 'Your price is now {nowC}.'],
    el: ['Η κοινή διαδρομή επιβεβαιώθηκε', 'Η τιμή σας είναι τώρα {nowC}.'],
    de: ['Geteilte Fahrt bestätigt', 'Ihr Preis beträgt jetzt {nowC}.'],
    fr: ['Trajet partagé confirmé', 'Votre prix est maintenant de {nowC}.'],
    pl: ['Wspólny przejazd potwierdzony', 'Twoja cena to teraz {nowC}.'],
    he: ['הנסיעה המשותפת אושרה', 'המחיר שלכם עכשיו {nowC}.'],
    ar: ['تم تأكيد الرحلة المشتركة', 'سعرك الآن {nowC}.'],
  },
  'share.assigned': {
    ru: ['Водитель назначен', '{driver} назначен на вашу поездку с попутчиком — следите за ним на карте.'],
    en: ['Driver assigned', '{driver} is assigned to your shared ride — track them live.'],
    el: ['Οδηγός ορίστηκε', 'Ο/Η {driver} ορίστηκε στην κοινή σας διαδρομή — παρακολουθήστε ζωντανά.'],
    de: ['Fahrer zugewiesen', '{driver} fährt Ihre geteilte Fahrt — live verfolgen.'],
    fr: ['Chauffeur attribué', '{driver} assure votre trajet partagé — suivez-le en direct.'],
    pl: ['Kierowca przydzielony', '{driver} obsłuży Twój wspólny przejazd — śledź na żywo.'],
    he: ['נהג שובץ', '{driver} שובץ לנסיעה המשותפת שלכם — עקבו בזמן אמת.'],
    ar: ['تم تعيين سائق', 'تم تعيين {driver} لرحلتك المشتركة — تابعه مباشرة.'],
  },
  'share.notComing': {
    ru: ['Попутчик не поедет', 'Вы едете один по обычной цене — без скидки.'],
    en: ['Your co-rider is not coming', 'You ride alone at the normal price — no discount.'],
    el: ['Ο συνεπιβάτης δεν έρχεται', 'Ταξιδεύετε μόνοι στην κανονική τιμή — χωρίς έκπτωση.'],
    de: ['Ihr Mitfahrer kommt nicht', 'Sie fahren allein zum normalen Preis — ohne Rabatt.'],
    fr: ['Votre covoyageur ne vient pas', 'Vous voyagez seul au prix normal — sans réduction.'],
    pl: ['Współpasażer nie jedzie', 'Jedziesz sam w zwykłej cenie — bez zniżki.'],
    he: ['הנוסע המשותף לא מגיע', 'אתם נוסעים לבד במחיר הרגיל — ללא הנחה.'],
    ar: ['الراكب المشارك لن يأتي', 'ستسافر وحدك بالسعر العادي — بدون خصم.'],
  },
  'share.driverLeft': {
    ru: ['Попутчик вышел из поездки', 'Один пассажир отказался от совместной поездки. Второй платит полную цену.'],
    en: ['Co-rider left the trip', 'One passenger left the shared ride. The other pays the full price.'],
    el: ['Ένας συνεπιβάτης αποχώρησε', 'Ένας επιβάτης αποχώρησε από την κοινή διαδρομή. Ο άλλος πληρώνει πλήρη τιμή.'],
    de: ['Mitfahrer hat die Fahrt verlassen', 'Ein Fahrgast hat die geteilte Fahrt verlassen. Der andere zahlt den vollen Preis.'],
    fr: ['Un covoyageur a quitté le trajet', 'Un passager a quitté le trajet partagé. L’autre paie le plein tarif.'],
    pl: ['Współpasażer zrezygnował', 'Jeden pasażer zrezygnował ze wspólnego przejazdu. Drugi płaci pełną cenę.'],
    he: ['נוסע עזב את הנסיעה', 'נוסע אחד עזב את הנסיעה המשותפת. השני משלם מחיר מלא.'],
    ar: ['غادر راكب الرحلة', 'غادر أحد الركاب الرحلة المشتركة. يدفع الآخر السعر الكامل.'],
  },
  'share.notPossible': {
    ru: ['Поездка с попутчиком не состоялась', 'Ни один водитель не взял совместную поездку — вы едете один по обычной цене.'],
    en: ['Shared ride not possible', 'No driver took the shared ride, so you ride alone at the normal price.'],
    el: ['Η κοινή διαδρομή δεν είναι δυνατή', 'Κανένας οδηγός δεν ανέλαβε την κοινή διαδρομή — ταξιδεύετε μόνοι στην κανονική τιμή.'],
    de: ['Geteilte Fahrt nicht möglich', 'Kein Fahrer hat die geteilte Fahrt übernommen — Sie fahren allein zum normalen Preis.'],
    fr: ['Trajet partagé impossible', 'Aucun chauffeur n’a pris le trajet partagé — vous voyagez seul au prix normal.'],
    pl: ['Wspólny przejazd niemożliwy', 'Żaden kierowca nie przyjął wspólnego przejazdu — jedziesz sam w zwykłej cenie.'],
    he: ['נסיעה משותפת לא אפשרית', 'אף נהג לא לקח את הנסיעה המשותפת — אתם נוסעים לבד במחיר הרגיל.'],
    ar: ['الرحلة المشتركة غير ممكنة', 'لم يقبل أي سائق الرحلة المشتركة — ستسافر وحدك بالسعر العادي.'],
  },
};
function msgText(msg, L) {
  const byLang = msg && MSG_TEXT[msg.k];
  const t = byLang && (byLang[L] || null);
  if (!t) return null;
  const p = msg.p || {};
  const fill = (str) => str.replace(/\{(\w+)\}/g, (_m, k) => {
    const v = p[k];
    if (v == null) return '';
    if (/C$/.test(k) && typeof v === 'number') {
      try { return new Intl.NumberFormat(L, { style: 'currency', currency: 'EUR' }).format(v / 100); } catch (_e) { return `€${(v / 100).toFixed(2)}`; }
    }
    return String(v);
  });
  return { title: fill(t[0]), body: fill(t[1]) };
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
    if (data.msg && !isOffer) {
      const mt = msgText(data.msg, await appLocale());
      if (mt) { title = mt.title; body = mt.body; }
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
