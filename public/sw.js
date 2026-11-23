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
  ru: { p: 'Нашёлся попутчик', d: 'Попутчик по пути', who: (a, c, l) => `взрослых: ${a}${c ? `, детей: ${c}` : ''}, чемоданов: ${l}`, longer: (n) => (n > 0 ? `+${n} мин` : 'время почти то же'), off: (p) => `−${p}%`, earn: (p) => `увеличит заработок на +${p}%`, tap: 'нажмите, чтобы ответить' },
  en: { p: 'A co-rider for your ride', d: 'Co-rider on your route', who: (a, c, l) => `${a} adult(s)${c ? `, ${c} child(ren)` : ''}, ${l} suitcase(s)`, longer: (n) => (n > 0 ? `+${n} min` : 'about the same time'), off: (p) => `−${p}%`, earn: (p) => `earnings up +${p}%`, tap: 'tap to answer' },
  el: { p: 'Βρέθηκε συνεπιβάτης', d: 'Συνεπιβάτης στη διαδρομή', who: (a, c, l) => `ενήλικες: ${a}${c ? `, παιδιά: ${c}` : ''}, βαλίτσες: ${l}`, longer: (n) => (n > 0 ? `+${n} λεπ.` : 'σχεδόν ίδιος χρόνος'), off: (p) => `−${p}%`, earn: (p) => `αύξηση κερδών +${p}%`, tap: 'πατήστε για απάντηση' },
  de: { p: 'Ein Mitfahrer für Ihre Fahrt', d: 'Mitfahrer auf Ihrer Strecke', who: (a, c, l) => `Erwachsene: ${a}${c ? `, Kinder: ${c}` : ''}, Koffer: ${l}`, longer: (n) => (n > 0 ? `+${n} Min.` : 'etwa gleich lang'), off: (p) => `−${p}%`, earn: (p) => `Verdienst +${p}%`, tap: 'zum Antworten tippen' },
  fr: { p: 'Un covoyageur pour votre trajet', d: 'Covoyageur sur votre trajet', who: (a, c, l) => `adultes : ${a}${c ? `, enfants : ${c}` : ''}, valises : ${l}`, longer: (n) => (n > 0 ? `+${n} min` : 'à peu près pareil'), off: (p) => `−${p}%`, earn: (p) => `gains +${p}%`, tap: 'touchez pour répondre' },
  pl: { p: 'Współpasażer do Twojego przejazdu', d: 'Współpasażer na trasie', who: (a, c, l) => `dorośli: ${a}${c ? `, dzieci: ${c}` : ''}, walizki: ${l}`, longer: (n) => (n > 0 ? `+${n} min` : 'mniej więcej tyle samo'), off: (p) => `−${p}%`, earn: (p) => `zarobek wzrośnie o +${p}%`, tap: 'stuknij, aby odpowiedzieć' },
  he: { p: 'נמצא נוסע משותף', d: 'נוסע משותף במסלול', who: (a, c, l) => `מבוגרים: ${a}${c ? `, ילדים: ${c}` : ''}, מזוודות: ${l}`, longer: (n) => (n > 0 ? `+${n} דק׳` : 'כמעט אותו זמן'), off: (p) => `−${p}%`, earn: (p) => `הרווח יגדל ב־+${p}%`, tap: 'הקישו כדי לענות' },
  ar: { p: 'وُجد راكب مشارك', d: 'راكب مشارك على مسارك', who: (a, c, l) => `بالغون: ${a}${c ? `، أطفال: ${c}` : ''}، حقائب: ${l}`, longer: (n) => (n > 0 ? `+${n} د` : 'نفس المدة تقريباً'), off: (p) => `−${p}%`, earn: (p) => `زيادة الأرباح +${p}%`, tap: 'اضغط للرد' },
};
function shareText(tag, body, L) {
  const S = SHARE_TEXT[L] || SHARE_TEXT.en;
  if (tag.startsWith('share-p-')) {
    // No prices (operator, 2026-11-22): «−30%».
    const m = /^(\d+) adults?(?:, (\d+) child(?:ren)?)?, (\d+) suitcases? · \+(\d+) min · −(\d+)% — tap to answer$/.exec(body || '');
    if (!m) return null;
    return { title: `👥 ${S.p}`, body: `${S.who(m[1], Number(m[2] || 0), m[3])} · ${S.longer(Number(m[4]))} · ${S.off(m[5])} — ${S.tap}` };
  }
  if (tag.startsWith('share-d-')) {
    // No sums for the driver (operator, 2026-11-22): «увеличит заработок на +40%».
    const m = /^\+(\d+) min · \+(\d+)% earnings — tap to answer$/.exec(body || '');
    if (!m) return null;
    return { title: `👥 ${S.d}`, body: `${S.longer(Number(m[1]))} · ${S.earn(m[2])} — ${S.tap}` };
  }
  return null;
}

// Other notifications sent with a text key (2026-11-22, server `msg: { k, p }` — src/server/push.ts
// PushMsg): shown in the app's language, or the phone's when the app has not saved one. A key or
// language missing here → the server's English title/body. `…C` values are euro cents.
const MSG_TEXT = {
  'share.joinGuest': {
    ru: ["Водитель назначен — поездка с попутчиком", "Вы едете с попутчиком: скидка −{pct}%."],
    en: ["Driver assigned — shared ride", "You share the car with a co-rider: −{pct}%."],
    el: ["Οδηγός ορίστηκε — κοινή διαδρομή", "Μοιράζεστε το ταξί με συνεπιβάτη: έκπτωση −{pct}%."],
    de: ["Fahrer zugewiesen — geteilte Fahrt", "Sie teilen das Auto mit einem Mitfahrer: −{pct}%."],
    fr: ["Chauffeur attribué — trajet partagé", "Vous partagez la voiture avec un covoyageur : −{pct}%."],
    pl: ["Kierowca przydzielony — wspólny przejazd", "Jedziesz ze współpasażerem: zniżka −{pct}%."],
    he: ["נהג שובץ — נסיעה משותפת", "אתם חולקים את הרכב עם נוסע נוסף: הנחה −{pct}%."],
    ar: ["تم تعيين سائق — رحلة مشتركة", "تتشارك السيارة مع راكب آخر: خصم −{pct}%."],
  },
  'share.joinHost': {
    ru: ["К вам присоединился попутчик", "Ваша поездка теперь со скидкой −{pct}%."],
    en: ["Co-rider joins", "Your ride is now −{pct}%."],
    el: ["Προστέθηκε συνεπιβάτης", "Η διαδρομή σας έχει τώρα έκπτωση −{pct}%."],
    de: ["Ein Mitfahrer steigt zu", "Ihre Fahrt kostet jetzt −{pct}%."],
    fr: ["Un covoyageur vous rejoint", "Votre trajet est maintenant à −{pct}%."],
    pl: ["Dołącza współpasażer", "Twój przejazd jest teraz tańszy o −{pct}%."],
    he: ["נוסע משותף מצטרף", "הנסיעה שלכם עכשיו בהנחה של −{pct}%."],
    ar: ["انضم راكب مشارك", "رحلتك الآن بخصم −{pct}%."],
  },
  'share.found': {
    ru: ["Попутчик найден", "Подача в {pickT}, на месте около {etaT}. К оплате {payC}."],
    en: ["Co-rider found", "Pickup at {pickT}, arrival about {etaT}. You pay {payC}."],
    el: ["Βρέθηκε συνεπιβάτης", "Παραλαβή στις {pickT}, άφιξη περίπου {etaT}. Πληρώνετε {payC}."],
    he: ["נמצא נוסע משותף", "איסוף ב-{pickT}, הגעה בערך {etaT}. לתשלום {payC}."],
    ar: ["تم العثور على راكب مشارك", "الاستلام الساعة {pickT}، الوصول نحو {etaT}. المبلغ {payC}."],
    pl: ["Znaleziono współpasażera", "Odbiór o {pickT}, przyjazd ok. {etaT}. Do zapłaty {payC}."],
    de: ["Mitfahrer gefunden", "Abholung um {pickT}, Ankunft ca. {etaT}. Sie zahlen {payC}."],
    fr: ["Covoyageur trouvé", "Prise en charge à {pickT}, arrivée vers {etaT}. À payer : {payC}."],
  },
  'share.confirmed': {
    ru: ["Поездка с попутчиком подтверждена", "Ваша поездка со скидкой −{pct}%."],
    en: ["Shared ride confirmed", "Your ride is now −{pct}%."],
    el: ["Η κοινή διαδρομή επιβεβαιώθηκε", "Η διαδρομή σας έχει έκπτωση −{pct}%."],
    de: ["Geteilte Fahrt bestätigt", "Ihre Fahrt kostet jetzt −{pct}%."],
    fr: ["Trajet partagé confirmé", "Votre trajet est à −{pct}%."],
    pl: ["Wspólny przejazd potwierdzony", "Twój przejazd jest tańszy o −{pct}%."],
    he: ["הנסיעה המשותפת אושרה", "הנסיעה שלכם בהנחה של −{pct}%."],
    ar: ["تم تأكيد الرحلة المشتركة", "رحلتك بخصم −{pct}%."],
  },
  'share.assigned': {
    ru: ["Водитель назначен", "{driver} назначен на вашу поездку с попутчиком — следите за ним на карте."],
    en: ["Driver assigned", "{driver} is assigned to your shared ride — track them live."],
    el: ["Οδηγός ορίστηκε", "Ο/Η {driver} ορίστηκε στην κοινή σας διαδρομή — παρακολουθήστε ζωντανά."],
    de: ["Fahrer zugewiesen", "{driver} fährt Ihre geteilte Fahrt — live verfolgen."],
    fr: ["Chauffeur attribué", "{driver} assure votre trajet partagé — suivez-le en direct."],
    pl: ["Kierowca przydzielony", "{driver} obsłuży Twój wspólny przejazd — śledź na żywo."],
    he: ["נהג שובץ", "{driver} שובץ לנסיעה המשותפת שלכם — עקבו בזמן אמת."],
    ar: ["تم تعيين سائق", "تم تعيين {driver} لرحلتك المشتركة — تابعه مباشرة."],
  },
  'share.notComing': {
    ru: ["Попутчик не поедет", "Вы едете один по обычной цене — без скидки."],
    en: ["Your co-rider is not coming", "You ride alone at the normal price — no discount."],
    el: ["Ο συνεπιβάτης δεν έρχεται", "Ταξιδεύετε μόνοι στην κανονική τιμή — χωρίς έκπτωση."],
    de: ["Ihr Mitfahrer kommt nicht", "Sie fahren allein zum normalen Preis — ohne Rabatt."],
    fr: ["Votre covoyageur ne vient pas", "Vous voyagez seul au prix normal — sans réduction."],
    pl: ["Współpasażer nie jedzie", "Jedziesz sam w zwykłej cenie — bez zniżki."],
    he: ["הנוסע המשותף לא מגיע", "אתם נוסעים לבד במחיר הרגיל — ללא הנחה."],
    ar: ["الراكب المشارك لن يأتي", "ستسافر وحدك بالسعر العادي — بدون خصم."],
  },
  'share.notPossible': {
    ru: ["Поездка с попутчиком не состоялась", "Ни один водитель не взял совместную поездку — вы едете один по обычной цене."],
    en: ["Shared ride not possible", "No driver took the shared ride, so you ride alone at the normal price."],
    el: ["Η κοινή διαδρομή δεν είναι δυνατή", "Κανένας οδηγός δεν ανέλαβε την κοινή διαδρομή — ταξιδεύετε μόνοι στην κανονική τιμή."],
    de: ["Geteilte Fahrt nicht möglich", "Kein Fahrer hat die geteilte Fahrt übernommen — Sie fahren allein zum normalen Preis."],
    fr: ["Trajet partagé impossible", "Aucun chauffeur n’a pris le trajet partagé — vous voyagez seul au prix normal."],
    pl: ["Wspólny przejazd niemożliwy", "Żaden kierowca nie przyjął wspólnego przejazdu — jedziesz sam w zwykłej cenie."],
    he: ["נסיעה משותפת לא אפשרית", "אף נהג לא לקח את הנסיעה המשותפת — אתם נוסעים לבד במחיר הרגיל."],
    ar: ["الرحلة المشتركة غير ممكنة", "لم يقبل أي سائق الرحلة المشتركة — ستسافر وحدك بالسعر العادي."],
  },
  'ride.arrived': {
    ru: ["Водитель прибыл", "Водитель ждёт вас на месте посадки."],
    en: ["Your driver has arrived", "Your driver is waiting at the pickup point."],
    el: ["Ο οδηγός έφτασε", "Ο οδηγός σας περιμένει στο σημείο παραλαβής."],
    de: ["Ihr Fahrer ist da", "Ihr Fahrer wartet am Abholort."],
    fr: ["Votre chauffeur est arrivé", "Votre chauffeur vous attend au point de prise en charge."],
    pl: ["Kierowca przyjechał", "Kierowca czeka na Ciebie w miejscu odbioru."],
    he: ["הנהג הגיע", "הנהג מחכה לכם בנקודת האיסוף."],
    ar: ["وصل السائق", "السائق بانتظارك في نقطة الالتقاء."],
  },
  'ride.atStop': {
    ru: ["Вы на остановке", "Водитель на остановке. Скажите ему, когда будете готовы ехать дальше."],
    en: ["Arrived at your stop", "Your driver is at the stop. Tell them when you are ready to continue."],
    el: ["Φτάσατε στη στάση", "Ο οδηγός είναι στη στάση. Πείτε του όταν είστε έτοιμοι να συνεχίσετε."],
    de: ["Am Zwischenhalt", "Ihr Fahrer ist am Zwischenhalt. Sagen Sie ihm, wenn Sie weiterfahren möchten."],
    fr: ["Arrivé à votre arrêt", "Votre chauffeur est à l’arrêt. Dites-lui quand vous êtes prêt à repartir."],
    pl: ["Jesteś na przystanku", "Kierowca jest na przystanku. Powiedz mu, gdy będziesz gotowy jechać dalej."],
    he: ["הגעתם לעצירה", "הנהג בעצירה. אמרו לו כשאתם מוכנים להמשיך."],
    ar: ["وصلت إلى محطة التوقف", "السائق في محطة التوقف. أخبره عندما تكون جاهزاً للمتابعة."],
  },
  'ride.noDriver': {
    ru: ["Нет свободных водителей", "Сейчас не удалось найти водителя. Нажмите, чтобы попробовать снова."],
    en: ["No driver available", "We couldn’t find a driver right now. Tap to try again."],
    el: ["Δεν υπάρχει διαθέσιμος οδηγός", "Δεν βρέθηκε οδηγός αυτή τη στιγμή. Πατήστε για να δοκιμάσετε ξανά."],
    de: ["Kein Fahrer verfügbar", "Gerade wurde kein Fahrer gefunden. Tippen Sie, um es erneut zu versuchen."],
    fr: ["Aucun chauffeur disponible", "Aucun chauffeur trouvé pour le moment. Touchez pour réessayer."],
    pl: ["Brak wolnych kierowców", "Nie udało się teraz znaleźć kierowcy. Stuknij, aby spróbować ponownie."],
    he: ["אין נהג פנוי", "לא מצאנו נהג כרגע. הקישו כדי לנסות שוב."],
    ar: ["لا يوجد سائق متاح", "لم نجد سائقاً الآن. اضغط للمحاولة مرة أخرى."],
  },
  'ride.assigned': {
    ru: ["Водитель назначен", "Водитель уже едет — следите за ним на карте."],
    en: ["Driver assigned", "A driver is on the way — track them live."],
    el: ["Οδηγός ορίστηκε", "Ο οδηγός έρχεται — παρακολουθήστε τον ζωντανά."],
    de: ["Fahrer zugewiesen", "Ein Fahrer ist unterwegs — live verfolgen."],
    fr: ["Chauffeur attribué", "Un chauffeur est en route — suivez-le en direct."],
    pl: ["Kierowca przydzielony", "Kierowca jest w drodze — śledź go na żywo."],
    he: ["נהג שובץ", "נהג בדרך — עקבו אחריו בזמן אמת."],
    ar: ["تم تعيين سائق", "السائق في الطريق — تابعه مباشرة."],
  },
  'ride.rematchChanged': {
    ru: ["Ищем другого водителя", "Водитель сменился — подбираем нового."],
    en: ["Finding you another driver", "Your driver was changed — we’re matching you again."],
    el: ["Αναζητούμε άλλον οδηγό", "Ο οδηγός άλλαξε — βρίσκουμε νέο."],
    de: ["Wir suchen einen anderen Fahrer", "Ihr Fahrer wurde gewechselt — wir suchen erneut."],
    fr: ["Nous cherchons un autre chauffeur", "Votre chauffeur a changé — nous en cherchons un nouveau."],
    pl: ["Szukamy innego kierowcy", "Kierowca się zmienił — szukamy nowego."],
    he: ["מחפשים לכם נהג אחר", "הנהג הוחלף — מחפשים נהג חדש."],
    ar: ["نبحث لك عن سائق آخر", "تم تغيير السائق — نبحث عن سائق جديد."],
  },
  'ride.rematchUnavailable': {
    ru: ["Ищем другого водителя", "Прежний водитель стал недоступен — подбираем нового."],
    en: ["Finding you another driver", "Your previous driver became unavailable — we’re matching you again."],
    el: ["Αναζητούμε άλλον οδηγό", "Ο προηγούμενος οδηγός δεν είναι διαθέσιμος — βρίσκουμε νέο."],
    de: ["Wir suchen einen anderen Fahrer", "Ihr bisheriger Fahrer ist nicht mehr verfügbar — wir suchen erneut."],
    fr: ["Nous cherchons un autre chauffeur", "Votre chauffeur n’est plus disponible — nous en cherchons un nouveau."],
    pl: ["Szukamy innego kierowcy", "Poprzedni kierowca jest niedostępny — szukamy nowego."],
    he: ["מחפשים לכם נהג אחר", "הנהג הקודם אינו זמין — מחפשים נהג חדש."],
    ar: ["نبحث لك عن سائق آخر", "السائق السابق غير متاح — نبحث عن سائق جديد."],
  },
  'ride.noShowFee': {
    ru: ["Поездка отменена — неявка", "Водитель ждал, но вы не вышли. Начислен сбор за неявку {feeC}."],
    en: ["Ride canceled — no-show", "The driver waited but you did not come. A no-show fee of {feeC} applies."],
    el: ["Η διαδρομή ακυρώθηκε — μη εμφάνιση", "Ο οδηγός περίμενε αλλά δεν ήρθατε. Χρέωση μη εμφάνισης {feeC}."],
    de: ["Fahrt storniert — nicht erschienen", "Der Fahrer hat gewartet, aber Sie kamen nicht. Gebühr für Nichterscheinen: {feeC}."],
    fr: ["Course annulée — absence", "Le chauffeur a attendu mais vous n’êtes pas venu. Frais d’absence : {feeC}."],
    pl: ["Przejazd anulowany — niestawienie się", "Kierowca czekał, ale nie przyszedłeś. Opłata za niestawienie się: {feeC}."],
    he: ["הנסיעה בוטלה — אי הגעה", "הנהג חיכה אבל לא הגעתם. חלה עמלת אי הגעה של {feeC}."],
    ar: ["أُلغيت الرحلة — عدم حضور", "انتظر السائق لكنك لم تأتِ. تُطبق رسوم عدم الحضور {feeC}."],
  },
  'ride.noShow': {
    ru: ["Поездка отменена — неявка", "Водитель ждал, но вы не вышли."],
    en: ["Ride canceled — no-show", "The driver waited but you did not come."],
    el: ["Η διαδρομή ακυρώθηκε — μη εμφάνιση", "Ο οδηγός περίμενε αλλά δεν ήρθατε."],
    de: ["Fahrt storniert — nicht erschienen", "Der Fahrer hat gewartet, aber Sie kamen nicht."],
    fr: ["Course annulée — absence", "Le chauffeur a attendu mais vous n’êtes pas venu."],
    pl: ["Przejazd anulowany — niestawienie się", "Kierowca czekał, ale nie przyszedłeś."],
    he: ["הנסיעה בוטלה — אי הגעה", "הנהג חיכה אבל לא הגעתם."],
    ar: ["أُلغيت الرحلة — عدم حضور", "انتظر السائق لكنك لم تأتِ."],
  },
  'pre.confirmed': {
    ru: ["Водитель подтверждён", "{driver} заберёт вас {whenD}."],
    en: ["Driver confirmed", "{driver} will pick you up {whenD}."],
    el: ["Ο οδηγός επιβεβαιώθηκε", "Ο/Η {driver} θα σας παραλάβει {whenD}."],
    de: ["Fahrer bestätigt", "{driver} holt Sie {whenD} ab."],
    fr: ["Chauffeur confirmé", "{driver} viendra vous chercher {whenD}."],
    pl: ["Kierowca potwierdzony", "{driver} odbierze Cię {whenD}."],
    he: ["הנהג אושר", "{driver} יאסוף אתכם {whenD}."],
    ar: ["تم تأكيد السائق", "سيقلّك {driver} في {whenD}."],
  },
  'pre.assigned': {
    ru: ["Водитель назначен", "{driver} назначен на вашу поездку — следите за ним на карте."],
    en: ["Driver assigned", "{driver} is assigned to your ride — track them live."],
    el: ["Οδηγός ορίστηκε", "Ο/Η {driver} ορίστηκε στη διαδρομή σας — παρακολουθήστε ζωντανά."],
    de: ["Fahrer zugewiesen", "{driver} fährt Sie — live verfolgen."],
    fr: ["Chauffeur attribué", "{driver} assure votre course — suivez-le en direct."],
    pl: ["Kierowca przydzielony", "{driver} obsłuży Twój przejazd — śledź na żywo."],
    he: ["נהג שובץ", "{driver} שובץ לנסיעה שלכם — עקבו בזמן אמת."],
    ar: ["تم تعيين سائق", "تم تعيين {driver} لرحلتك — تابعه مباشرة."],
  },
  'pre.lapsedLate': {
    ru: ["Меняем водителя", "К сожалению, водитель не успел выйти на линию вовремя. Мы сейчас назначим другого водителя."],
    en: ["Finding you a driver", "Sorry, the driver did not get online in time. We are assigning you another driver now."],
    el: ["Αλλάζουμε οδηγό", "Δυστυχώς ο οδηγός δεν συνδέθηκε εγκαίρως. Σας ορίζουμε τώρα άλλον οδηγό."],
    de: ["Wir wechseln den Fahrer", "Leider war der Fahrer nicht rechtzeitig online. Wir weisen Ihnen jetzt einen anderen Fahrer zu."],
    fr: ["Nous changeons de chauffeur", "Désolé, le chauffeur ne s’est pas connecté à temps. Nous vous attribuons un autre chauffeur."],
    pl: ["Zmieniamy kierowcę", "Niestety kierowca nie zdążył wyjść na linię. Zaraz przydzielimy innego kierowcę."],
    he: ["מחליפים נהג", "מצטערים, הנהג לא התחבר בזמן. אנחנו משבצים לכם עכשיו נהג אחר."],
    ar: ["نغيّر السائق", "للأسف لم يتصل السائق في الوقت المحدد. سنعيّن لك سائقاً آخر الآن."],
  },
  'pre.reassign': {
    ru: ["Меняем водителя", "Мы сейчас назначим вам другого водителя."],
    en: ["Finding you a driver", "We are assigning you another driver now."],
    el: ["Αλλάζουμε οδηγό", "Σας ορίζουμε τώρα άλλον οδηγό."],
    de: ["Wir wechseln den Fahrer", "Wir weisen Ihnen jetzt einen anderen Fahrer zu."],
    fr: ["Nous changeons de chauffeur", "Nous vous attribuons un autre chauffeur."],
    pl: ["Zmieniamy kierowcę", "Zaraz przydzielimy Ci innego kierowcę."],
    he: ["מחליפים נהג", "אנחנו משבצים לכם עכשיו נהג אחר."],
    ar: ["نغيّر السائق", "سنعيّن لك سائقاً آخر الآن."],
  },
  'pre.remind60': {
    ru: ["Ваш предзаказ примерно через час", "Посадка в {timeT} — {place}."],
    en: ["Your pre-booked ride is in about an hour", "Pickup at {timeT} — {place}."],
    el: ["Η προκράτησή σας σε περίπου μία ώρα", "Παραλαβή στις {timeT} — {place}."],
    de: ["Ihre vorbestellte Fahrt in etwa einer Stunde", "Abholung um {timeT} — {place}."],
    fr: ["Votre course réservée dans environ une heure", "Prise en charge à {timeT} — {place}."],
    pl: ["Twój przejazd za około godzinę", "Odbiór o {timeT} — {place}."],
    he: ["הנסיעה שהזמנתם בעוד כשעה", "איסוף ב־{timeT} — {place}."],
    ar: ["رحلتك المحجوزة بعد ساعة تقريباً", "الالتقاء الساعة {timeT} — {place}."],
  },
  'pre.remind30': {
    ru: ["Ваш предзаказ через 30 минут", "Посадка в {timeT} — {place}."],
    en: ["Your pre-booked ride is in 30 minutes", "Pickup at {timeT} — {place}."],
    el: ["Η προκράτησή σας σε 30 λεπτά", "Παραλαβή στις {timeT} — {place}."],
    de: ["Ihre vorbestellte Fahrt in 30 Minuten", "Abholung um {timeT} — {place}."],
    fr: ["Votre course réservée dans 30 minutes", "Prise en charge à {timeT} — {place}."],
    pl: ["Twój przejazd za 30 minut", "Odbiór o {timeT} — {place}."],
    he: ["הנסיעה שהזמנתם בעוד 30 דקות", "איסוף ב־{timeT} — {place}."],
    ar: ["رحلتك المحجوزة بعد 30 دقيقة", "الالتقاء الساعة {timeT} — {place}."],
  },
  'drv.stopAdded': {
    ru: ["Пассажир добавил остановку", "Построен новый маршрут."],
    en: ["Stop added by the passenger", "A new route has been built."],
    el: ["Ο επιβάτης πρόσθεσε στάση", "Δημιουργήθηκε νέα διαδρομή."],
    de: ["Fahrgast hat einen Halt hinzugefügt", "Eine neue Route wurde berechnet."],
    fr: ["Le passager a ajouté un arrêt", "Un nouvel itinéraire a été calculé."],
    pl: ["Pasażer dodał przystanek", "Wyznaczono nową trasę."],
    he: ["הנוסע הוסיף עצירה", "נבנה מסלול חדש."],
    ar: ["أضاف الراكب محطة توقف", "تم إنشاء مسار جديد."],
  },
  'drv.stopRemoved': {
    ru: ["Пассажир убрал остановку", "Строим новый маршрут."],
    en: ["Stop removed by the passenger", "Building a new route."],
    el: ["Ο επιβάτης αφαίρεσε τη στάση", "Δημιουργούμε νέα διαδρομή."],
    de: ["Fahrgast hat den Halt entfernt", "Neue Route wird berechnet."],
    fr: ["Le passager a retiré l’arrêt", "Calcul d’un nouvel itinéraire."],
    pl: ["Pasażer usunął przystanek", "Wyznaczamy nową trasę."],
    he: ["הנוסע ביטל את העצירה", "בונים מסלול חדש."],
    ar: ["أزال الراكب محطة التوقف", "نُنشئ مساراً جديداً."],
  },
  'drv.rideCanceled': {
    ru: ["Поездка отменена", "Пассажир отменил поездку."],
    en: ["Ride canceled", "The passenger canceled this ride."],
    el: ["Η διαδρομή ακυρώθηκε", "Ο επιβάτης ακύρωσε τη διαδρομή."],
    de: ["Fahrt storniert", "Der Fahrgast hat die Fahrt storniert."],
    fr: ["Course annulée", "Le passager a annulé la course."],
    pl: ["Przejazd anulowany", "Pasażer anulował przejazd."],
    he: ["הנסיעה בוטלה", "הנוסע ביטל את הנסיעה."],
    ar: ["أُلغيت الرحلة", "ألغى الراكب الرحلة."],
  },
  'drv.preSoon': {
    ru: ["Скоро предзаказ", "Посадка в {timeT}, {place}. Выйдите на линию вовремя."],
    en: ["Upcoming pre-booked ride", "Pickup {timeT} at {place}. Go online in time."],
    el: ["Προκράτηση σύντομα", "Παραλαβή στις {timeT}, {place}. Συνδεθείτε εγκαίρως."],
    de: ["Vorbestellte Fahrt bald", "Abholung {timeT}, {place}. Rechtzeitig online gehen."],
    fr: ["Course réservée bientôt", "Prise en charge à {timeT}, {place}. Connectez-vous à temps."],
    pl: ["Wkrótce przejazd z rezerwacji", "Odbiór o {timeT}, {place}. Wyjdź na linię na czas."],
    he: ["נסיעה שהוזמנה מראש בקרוב", "איסוף ב־{timeT}, {place}. התחברו בזמן."],
    ar: ["رحلة محجوزة قريباً", "الالتقاء الساعة {timeT}، {place}. اتصل في الوقت المحدد."],
  },
  'drv.preSoonFlight': {
    ru: ["Скоро предзаказ", "Посадка в {timeT}, {place} · рейс {flight}. Выйдите на линию вовремя."],
    en: ["Upcoming pre-booked ride", "Pickup {timeT} at {place} · flight {flight}. Go online in time."],
    el: ["Προκράτηση σύντομα", "Παραλαβή στις {timeT}, {place} · πτήση {flight}. Συνδεθείτε εγκαίρως."],
    de: ["Vorbestellte Fahrt bald", "Abholung {timeT}, {place} · Flug {flight}. Rechtzeitig online gehen."],
    fr: ["Course réservée bientôt", "Prise en charge à {timeT}, {place} · vol {flight}. Connectez-vous à temps."],
    pl: ["Wkrótce przejazd z rezerwacji", "Odbiór o {timeT}, {place} · lot {flight}. Wyjdź na linię na czas."],
    he: ["נסיעה שהוזמנה מראש בקרוב", "איסוף ב־{timeT}, {place} · טיסה {flight}. התחברו בזמן."],
    ar: ["رحلة محجوزة قريباً", "الالتقاء الساعة {timeT}، {place} · رحلة {flight}. اتصل في الوقت المحدد."],
  },
  'drv.preReassigned': {
    ru: ["Изменение по предзаказу", "Оператор передал ваш предзаказ другому водителю."],
    en: ["Pre-booked ride update", "A pre-booked ride you took was assigned to another driver by the operator."],
    el: ["Ενημέρωση προκράτησης", "Ο διαχειριστής ανέθεσε την προκράτησή σας σε άλλον οδηγό."],
    de: ["Änderung der vorbestellten Fahrt", "Der Betreiber hat Ihre vorbestellte Fahrt einem anderen Fahrer gegeben."],
    fr: ["Mise à jour de la course réservée", "L’opérateur a confié votre course réservée à un autre chauffeur."],
    pl: ["Zmiana w rezerwacji", "Operator przekazał Twój przejazd innemu kierowcy."],
    he: ["עדכון לנסיעה שהוזמנה מראש", "המפעיל העביר את הנסיעה שלכם לנהג אחר."],
    ar: ["تحديث للرحلة المحجوزة", "أسند المشغّل رحلتك المحجوزة إلى سائق آخر."],
  },
  'drv.preCanceled': {
    ru: ["Изменение по предзаказу", "Пассажир отменил ваш предзаказ."],
    en: ["Pre-booked ride update", "A ride you pre-booked was canceled by the passenger."],
    el: ["Ενημέρωση προκράτησης", "Ο επιβάτης ακύρωσε την προκράτησή σας."],
    de: ["Änderung der vorbestellten Fahrt", "Der Fahrgast hat Ihre vorbestellte Fahrt storniert."],
    fr: ["Mise à jour de la course réservée", "Le passager a annulé votre course réservée."],
    pl: ["Zmiana w rezerwacji", "Pasażer anulował Twój przejazd z rezerwacji."],
    he: ["עדכון לנסיעה שהוזמנה מראש", "הנוסע ביטל את הנסיעה שהוזמנה מראש."],
    ar: ["تحديث للرحلة المحجوزة", "ألغى الراكب رحلتك المحجوزة."],
  },
  'drv.preReleased': {
    ru: ["Изменение по предзаказу", "Ваш предзаказ снят."],
    en: ["Pre-booked ride update", "Your pre-booked ride was released."],
    el: ["Ενημέρωση προκράτησης", "Η προκράτησή σας αποδεσμεύτηκε."],
    de: ["Änderung der vorbestellten Fahrt", "Ihre vorbestellte Fahrt wurde freigegeben."],
    fr: ["Mise à jour de la course réservée", "Votre course réservée a été libérée."],
    pl: ["Zmiana w rezerwacji", "Twój przejazd z rezerwacji został zwolniony."],
    he: ["עדכון לנסיעה שהוזמנה מראש", "הנסיעה שהוזמנה מראש שוחררה."],
    ar: ["تحديث للرحلة المحجوزة", "تم إلغاء إسناد رحلتك المحجوزة."],
  },
  'drv.preReleasedIneligible': {
    ru: ["Изменение по предзаказу", "Ваш предзаказ снят: ваш аккаунт или машина сейчас не допущены."],
    en: ["Pre-booked ride update", "Your pre-booked ride was released: your account or vehicle is not eligible right now."],
    el: ["Ενημέρωση προκράτησης", "Η προκράτησή σας αποδεσμεύτηκε: ο λογαριασμός ή το όχημά σας δεν είναι επιλέξιμα τώρα."],
    de: ["Änderung der vorbestellten Fahrt", "Ihre vorbestellte Fahrt wurde freigegeben: Konto oder Fahrzeug sind derzeit nicht zugelassen."],
    fr: ["Mise à jour de la course réservée", "Votre course réservée a été libérée : votre compte ou véhicule n’est pas éligible actuellement."],
    pl: ["Zmiana w rezerwacji", "Twój przejazd został zwolniony: konto lub pojazd nie są teraz dopuszczone."],
    he: ["עדכון לנסיעה שהוזמנה מראש", "הנסיעה שוחררה: החשבון או הרכב שלכם אינם מאושרים כרגע."],
    ar: ["تحديث للرحلة المحجوزة", "تم إلغاء رحلتك المحجوزة: حسابك أو سيارتك غير مؤهلين حالياً."],
  },
  'drv.preLapsedBusy': {
    ru: ["Изменение по предзаказу", "Предзаказ передан в автоматический поиск: вы были на другом заказе."],
    en: ["Pre-booked ride update", "Your pre-booked ride was handed to automatic dispatch because you were still on another trip."],
    el: ["Ενημέρωση προκράτησης", "Η προκράτηση πέρασε στην αυτόματη ανάθεση: ήσασταν σε άλλη διαδρομή."],
    de: ["Änderung der vorbestellten Fahrt", "Ihre vorbestellte Fahrt ging an die automatische Vermittlung: Sie waren noch auf einer anderen Fahrt."],
    fr: ["Mise à jour de la course réservée", "Votre course réservée est passée en attribution automatique : vous étiez encore sur une autre course."],
    pl: ["Zmiana w rezerwacji", "Przejazd przekazano do automatycznego wyszukiwania: byłeś na innym kursie."],
    he: ["עדכון לנסיעה שהוזמנה מראש", "הנסיעה הועברה לשיבוץ אוטומטי: הייתם בנסיעה אחרת."],
    ar: ["تحديث للرحلة المحجوزة", "تم تحويل رحلتك المحجوزة إلى التوزيع التلقائي: كنت في رحلة أخرى."],
  },
  'drv.preLapsedOffline': {
    ru: ["Изменение по предзаказу", "Предзаказ передан в автоматический поиск: вы были не на линии."],
    en: ["Pre-booked ride update", "Your pre-booked ride was handed to automatic dispatch because you were offline."],
    el: ["Ενημέρωση προκράτησης", "Η προκράτηση πέρασε στην αυτόματη ανάθεση: δεν ήσασταν συνδεδεμένοι."],
    de: ["Änderung der vorbestellten Fahrt", "Ihre vorbestellte Fahrt ging an die automatische Vermittlung: Sie waren offline."],
    fr: ["Mise à jour de la course réservée", "Votre course réservée est passée en attribution automatique : vous étiez hors ligne."],
    pl: ["Zmiana w rezerwacji", "Przejazd przekazano do automatycznego wyszukiwania: nie byłeś na linii."],
    he: ["עדכון לנסיעה שהוזמנה מראש", "הנסיעה הועברה לשיבוץ אוטומטי: לא הייתם מחוברים."],
    ar: ["تحديث للرحلة المحجوزة", "تم تحويل رحلتك المحجوزة إلى التوزيع التلقائي: كنت غير متصل."],
  },
  'drv.goOnline': {
    ru: ["⏱ {left}:00", "осталось до выхода на линию · {place}, {timeT}"],
    en: ["⏱ {left}:00", "left to go online · {place}, {timeT}"],
    el: ["⏱ {left}:00", "απομένουν για να συνδεθείτε · {place}, {timeT}"],
    de: ["⏱ {left}:00", "bis Sie online sein müssen · {place}, {timeT}"],
    fr: ["⏱ {left}:00", "avant de vous connecter · {place}, {timeT}"],
    pl: ["⏱ {left}:00", "do wyjścia na linię · {place}, {timeT}"],
    he: ["⏱ {left}:00", "נותרו עד ההתחברות · {place}, {timeT}"],
    ar: ["⏱ {left}:00", "متبقٍ حتى الاتصال · {place}، {timeT}"],
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
    // …T: a time (ISO) shown as the Cyprus clock time; …D: date + time — in the language's own format.
    if (/[TD]$/.test(k) && typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) {
      const opts = /T$/.test(k) ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
      try { return new Intl.DateTimeFormat(L, { timeZone: 'Europe/Nicosia', ...opts }).format(new Date(v)); } catch (_e) { return v.slice(11, 16); }
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
    // Countdown to going online (2026-11-22): the first one rings, the next minutes replace it quietly.
    const quiet = !!(data.msg && data.msg.k === 'drv.goOnline' && data.msg.p && Number(data.msg.p.left) < 5);
    await self.registration.showNotification(title, {
      body,
      tag: data.tag,
      renotify: !quiet,
      silent: quiet,
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
