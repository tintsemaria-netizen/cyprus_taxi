/* IL-Y service worker — Web Push notifications (ride offers, chat, ride updates).
   Notifications supplement the in-app polling; they are best-effort. */

// Ride offers (2026-11-15): while the driver is in ANOTHER app the offer arrives as a heads-up
// banner from the top, with the system sound and a long vibration, in the driver's language.
// It closes itself when the offer expires so a stale offer is never left on screen.
const OFFER_TTL_MS = 12000; // offer lifetime (10 s) + delivery slack

const OFFER_TEXT = {
  ru: { next: 'Следующий заказ — после высадки', title: 'Новый заказ', min: (n) => `~${n} мин до клиента`, tap: 'нажмите, чтобы открыть', near: 'Клиент рядом' },
  el: { next: 'Επόμενη κούρσα — μετά την αποβίβαση', title: 'Νέα κούρσα', min: (n) => `~${n} λεπτά μέχρι τον πελάτη`, tap: 'πατήστε για άνοιγμα', near: 'Πελάτης κοντά' },
  en: { next: 'Next ride — after the drop-off', title: 'New ride offer', min: (n) => `~${n} min to the pickup`, tap: 'tap to open', near: 'Pickup nearby' },
  he: { next: 'ההזמנה הבאה — אחרי ההורדה', title: 'הזמנה חדשה', min: (n) => `~${n} דק׳ עד הלקוח`, tap: 'הקישו לפתיחה', near: 'הלקוח קרוב' },
  ar: { next: 'الطلب التالي — بعد الإنزال', title: 'طلب جديد', min: (n) => `~${n} د حتى العميل`, tap: 'اضغط للفتح', near: 'العميل قريب' },
  pl: { next: 'Następne zlecenie — po wysadzeniu', title: 'Nowe zlecenie', min: (n) => `~${n} min do klienta`, tap: 'stuknij, aby otworzyć', near: 'Klient w pobliżu' },
  de: { next: 'Nächster Auftrag — nach dem Absetzen', title: 'Neuer Auftrag', min: (n) => `~${n} Min. bis zum Kunden`, tap: 'zum Öffnen tippen', near: 'Kunde in der Nähe' },
  fr: { next: 'Course suivante — après la dépose', title: 'Nouvelle course', min: (n) => `~${n} min jusqu’au client`, tap: 'touchez pour ouvrir', near: 'Client à proximité' },
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
  // Chat (2026-11-24): the title in the reader's language, the message itself as written.
  'chat.fromDriver': {
    ru: ["Сообщение от водителя", "{text}"],
    en: ["Message from your driver", "{text}"],
    el: ["Μήνυμα από τον οδηγό", "{text}"],
    de: ["Nachricht von Ihrem Fahrer", "{text}"],
    fr: ["Message de votre chauffeur", "{text}"],
    pl: ["Wiadomość od kierowcy", "{text}"],
    he: ["הודעה מהנהג", "{text}"],
    ar: ["رسالة من السائق", "{text}"],
  },
  'chat.fromPassenger': {
    ru: ["Сообщение от пассажира", "{text}"],
    en: ["Message from your passenger", "{text}"],
    el: ["Μήνυμα από τον επιβάτη", "{text}"],
    de: ["Nachricht vom Fahrgast", "{text}"],
    fr: ["Message de votre passager", "{text}"],
    pl: ["Wiadomość od pasażera", "{text}"],
    he: ["הודעה מהנוסע", "{text}"],
    ar: ["رسالة من الراكب", "{text}"],
  },
  // Driver document expiry and «pre-booking active» (2026-11-24, operator: Greek, Russian and English first).
  'driver.docExpired': {
    ru: ["Документы просрочены", "Срок обязательного документа истёк. Новые поездки недоступны, пока документ не обновят и не проверят снова."],
    en: ["Documents expired", "A required document expired. You cannot take new rides until it is renewed and re-reviewed."],
    el: ["Τα έγγραφα έληξαν", "Ένα υποχρεωτικό έγγραφο έληξε. Δεν μπορείτε να πάρετε νέες διαδρομές μέχρι να ανανεωθεί και να ελεγχθεί ξανά."],
    de: ["Dokumente abgelaufen", "Ein Pflichtdokument ist abgelaufen. Neue Fahrten sind erst nach Erneuerung und erneuter Prüfung möglich."],
    fr: ["Documents expirés", "Un document obligatoire a expiré. Vous ne pouvez plus prendre de courses tant qu'il n'est pas renouvelé et revérifié."],
    pl: ["Dokumenty wygasły", "Wymagany dokument wygasł. Nowe kursy są niedostępne, dopóki nie zostanie odnowiony i ponownie sprawdzony."],
    he: ["פג תוקף מסמכים", "פג תוקפו של מסמך חובה. לא ניתן לקבל נסיעות חדשות עד שיחודש וייבדק מחדש."],
    ar: ["انتهت صلاحية المستندات", "انتهت صلاحية مستند مطلوب. لا يمكنك قبول رحلات جديدة حتى يتم تجديده ومراجعته مرة أخرى."],
  },
  'driver.docExpiring': {
    ru: ["Документ скоро истекает", "Срок обязательного документа истекает через {days} дн. Обновите его, чтобы продолжать работать."],
    en: ["Document expiring soon", "A required document expires in {days} day(s). Renew it to keep driving."],
    el: ["Έγγραφο λήγει σύντομα", "Ένα υποχρεωτικό έγγραφο λήγει σε {days} ημ. Ανανεώστε το για να συνεχίσετε να οδηγείτε."],
    de: ["Dokument läuft bald ab", "Ein Pflichtdokument läuft in {days} Tag(en) ab. Erneuern Sie es, um weiterzufahren."],
    fr: ["Document bientôt expiré", "Un document obligatoire expire dans {days} jour(s). Renouvelez-le pour continuer à rouler."],
    pl: ["Dokument wkrótce wygaśnie", "Wymagany dokument wygaśnie za {days} dn. Odnów go, aby dalej jeździć."],
    he: ["תוקף מסמך יפוג בקרוב", "תוקפו של מסמך חובה יפוג בעוד {days} ימים. חדשו אותו כדי להמשיך לנהוג."],
    ar: ["مستند ستنتهي صلاحيته قريبًا", "تنتهي صلاحية مستند مطلوب خلال {days} يوم. جدّده لتستمر في القيادة."],
  },
  // Document renewal (2026-11-24): {slot} is the document's name in the reader's language (SLOT_NAME).
  "drv.docExpiring": {
    ru: ["Документ скоро истекает", "{slot}: срок истекает через {days} дн. Загрузите новый: меню → Документы."],
    en: ["Document expiring", "{slot} expires in {days} day(s). Upload the new one: menu → Documents."],
    el: ["Έγγραφο λήγει", "{slot}: λήγει σε {days} ημ. Ανεβάστε το νέο: μενού → Έγγραφα."],
    de: ["Dokument läuft ab", "{slot} läuft in {days} Tag(en) ab. Laden Sie das neue hoch: Menü → Dokumente."],
    fr: ["Document bientôt expiré", "{slot} expire dans {days} jour(s). Envoyez le nouveau : menu → Documents."],
    pl: ["Dokument wygasa", "{slot}: wygasa za {days} dn. Wgraj nowy: menu → Dokumenty."],
    he: ["תוקף מסמך עומד לפוג", "{slot}: התוקף פג בעוד {days} ימים. העלו את החדש: תפריט ← מסמכים."],
    ar: ["مستند ستنتهي صلاحيته", "{slot}: تنتهي الصلاحية خلال {days} يوم. ارفع الجديد: القائمة ← المستندات."],
  },
  "drv.docExpired": {
    ru: ["Документ просрочен", "{slot}: срок истёк. Загрузите новый (меню → Документы), чтобы снова брать заказы."],
    en: ["Document expired", "{slot} has expired. Upload the new one (menu → Documents) to take rides again."],
    el: ["Το έγγραφο έληξε", "{slot}: έληξε. Ανεβάστε το νέο (μενού → Έγγραφα) για να παίρνετε ξανά διαδρομές."],
    de: ["Dokument abgelaufen", "{slot} ist abgelaufen. Laden Sie das neue hoch (Menü → Dokumente), um wieder Fahrten zu bekommen."],
    fr: ["Document expiré", "{slot} a expiré. Envoyez le nouveau (menu → Documents) pour reprendre des courses."],
    pl: ["Dokument wygasł", "{slot}: wygasł. Wgraj nowy (menu → Dokumenty), aby znów brać kursy."],
    he: ["תוקף המסמך פג", "{slot}: התוקף פג. העלו את החדש (תפריט ← מסמכים) כדי לקבל שוב נסיעות."],
    ar: ["انتهت صلاحية المستند", "{slot}: انتهت الصلاحية. ارفع الجديد (القائمة ← المستندات) لتستقبل الرحلات مجددًا."],
  },
  "drv.docReturned": {
    ru: ["Документ не принят", "Оператор не принял новый документ ({slot}). Загрузите его ещё раз: меню → Документы."],
    en: ["Document not accepted", "The operator did not accept your new document ({slot}). Upload it again: menu → Documents."],
    el: ["Το έγγραφο δεν έγινε δεκτό", "Ο διαχειριστής δεν δέχτηκε το νέο έγγραφο ({slot}). Ανεβάστε το ξανά: μενού → Έγγραφα."],
    de: ["Dokument nicht angenommen", "Der Betreiber hat Ihr neues Dokument ({slot}) nicht angenommen. Bitte erneut hochladen: Menü → Dokumente."],
    fr: ["Document refusé", "L'opérateur n'a pas accepté votre nouveau document ({slot}). Renvoyez-le : menu → Documents."],
    pl: ["Dokument nieprzyjęty", "Operator nie przyjął nowego dokumentu ({slot}). Wgraj go ponownie: menu → Dokumenty."],
    he: ["המסמך לא אושר", "המפעיל לא אישר את המסמך החדש ({slot}). העלו אותו שוב: תפריט ← מסמכים."],
    ar: ["لم يُقبل المستند", "لم يقبل المشغّل مستندك الجديد ({slot}). ارفعه مرة أخرى: القائمة ← المستندات."],
  },
  "staff.docUploaded": {
    ru: ["Новый документ на проверку", "{who}: загружен новый документ — {slot}. Проверить"],
    en: ["New document to check", "{who}: new {slot} — check it"],
    el: ["Νέο έγγραφο για έλεγχο", "{who}: νέο έγγραφο — {slot}. Έλεγχος"],
    de: ["Neues Dokument zu prüfen", "{who}: neues Dokument — {slot}. Prüfen"],
    fr: ["Nouveau document à vérifier", "{who} : nouveau document — {slot}. Vérifier"],
    pl: ["Nowy dokument do sprawdzenia", "{who}: nowy dokument — {slot}. Sprawdź"],
    he: ["מסמך חדש לבדיקה", "{who}: מסמך חדש — {slot}. לבדוק"],
    ar: ["مستند جديد للمراجعة", "{who}: مستند جديد — {slot}. راجِعه"],
  },
  "staff.docReminder": {
    ru: ["Документ ждёт проверки", "{who}: новый документ ({slot}) ждёт проверки"],
    en: ["Document still to check", "{who}: new {slot} waits for you"],
    el: ["Έγγραφο περιμένει έλεγχο", "{who}: το νέο έγγραφο ({slot}) περιμένει έλεγχο"],
    de: ["Dokument wartet auf Prüfung", "{who}: neues Dokument ({slot}) wartet auf Prüfung"],
    fr: ["Document en attente", "{who} : le nouveau document ({slot}) attend votre vérification"],
    pl: ["Dokument czeka na sprawdzenie", "{who}: nowy dokument ({slot}) czeka na sprawdzenie"],
    he: ["מסמך ממתין לבדיקה", "{who}: המסמך החדש ({slot}) ממתין לבדיקה"],
    ar: ["مستند بانتظار المراجعة", "{who}: المستند الجديد ({slot}) بانتظار المراجعة"],
  },
  "staff.docUrgent": {
    ru: ["Срочно: непроверенный документ", "{who} работает с непроверенным документом ({slot}) — старый истёк {date}"],
    en: ["Urgent: unchecked document", "{who} works with an unchecked {slot}; the old one expired {date}"],
    el: ["Επείγον: μη ελεγμένο έγγραφο", "{who} δουλεύει με μη ελεγμένο έγγραφο ({slot}) — το παλιό έληξε {date}"],
    de: ["Dringend: ungeprüftes Dokument", "{who} fährt mit ungeprüftem Dokument ({slot}) — das alte ist am {date} abgelaufen"],
    fr: ["Urgent : document non vérifié", "{who} roule avec un document non vérifié ({slot}) — l'ancien a expiré le {date}"],
    pl: ["Pilne: niesprawdzony dokument", "{who} pracuje z niesprawdzonym dokumentem ({slot}) — stary wygasł {date}"],
    he: ["דחוף: מסמך לא נבדק", "{who} עובד עם מסמך שלא נבדק ({slot}) — הישן פג ב-{date}"],
    ar: ["عاجل: مستند غير مُراجَع", "{who} يعمل بمستند غير مُراجَع ({slot}) — انتهى القديم في {date}"],
  },
  "staff.docExpiring": {
    ru: ["Документ истекает", "{who}: срок документа ({slot}) истекает через {days} дн., новый не загружен"],
    en: ["Document expiring", "{who}: {slot} expires in {days} day(s), nothing new uploaded"],
    el: ["Έγγραφο λήγει", "{who}: το έγγραφο ({slot}) λήγει σε {days} ημ., δεν ανέβηκε νέο"],
    de: ["Dokument läuft ab", "{who}: Dokument ({slot}) läuft in {days} Tag(en) ab, nichts Neues hochgeladen"],
    fr: ["Document bientôt expiré", "{who} : le document ({slot}) expire dans {days} jour(s), rien de nouveau envoyé"],
    pl: ["Dokument wygasa", "{who}: dokument ({slot}) wygasa za {days} dn., nowego nie wgrano"],
    he: ["תוקף מסמך עומד לפוג", "{who}: תוקף המסמך ({slot}) פג בעוד {days} ימים, לא הועלה חדש"],
    ar: ["مستند ستنتهي صلاحيته", "{who}: تنتهي صلاحية المستند ({slot}) خلال {days} يوم، ولم يُرفع جديد"],
  },
  // «Мои машины» (2026-11-24).
  "drv.carAsk": {
    ru: ["Просят вашу машину", "{who} просит разрешение ездить на {plate}. Ответьте в меню → Мои машины."],
    en: ["A driver asks for your car", "{who} asks to drive {plate}. Answer in the menu → My cars."],
    el: ["Ζητούν το αυτοκίνητό σας", "Ο/Η {who} ζητά να οδηγεί το {plate}. Απαντήστε: μενού → Τα αυτοκίνητά μου."],
    de: ["Anfrage für Ihr Auto", "{who} möchte {plate} fahren. Antworten Sie: Menü → Meine Autos."],
    fr: ["Demande pour votre voiture", "{who} demande à conduire {plate}. Répondez : menu → Mes voitures."],
    pl: ["Prośba o Twoje auto", "{who} prosi o jazdę autem {plate}. Odpowiedz: menu → Moje auta."],
    he: ["מבקשים את הרכב שלך", "{who} מבקש לנהוג ב-{plate}. ענו בתפריט ← הרכבים שלי."],
    ar: ["طلب لسيارتك", "{who} يطلب قيادة {plate}. أجب من القائمة ← سياراتي."],
  },
  "drv.carOk": {
    ru: ["Машина разрешена", "Теперь вы можете работать на {plate}: меню → Мои машины."],
    en: ["Car allowed", "You may now drive {plate}: menu → My cars."],
    el: ["Το αυτοκίνητο εγκρίθηκε", "Μπορείτε πλέον να οδηγείτε το {plate}: μενού → Τα αυτοκίνητά μου."],
    de: ["Auto freigegeben", "Sie dürfen jetzt {plate} fahren: Menü → Meine Autos."],
    fr: ["Voiture autorisée", "Vous pouvez maintenant conduire {plate} : menu → Mes voitures."],
    pl: ["Auto dozwolone", "Możesz teraz jeździć autem {plate}: menu → Moje auta."],
    he: ["הרכב אושר", "עכשיו אפשר לעבוד על {plate}: תפריט ← הרכבים שלי."],
    ar: ["تمت الموافقة على السيارة", "يمكنك الآن العمل على {plate}: القائمة ← سياراتي."],
  },
  "drv.carNo": {
    ru: ["Машина не разрешена", "Вам не разрешили работать на {plate}."],
    en: ["Car not allowed", "You were not allowed to drive {plate}."],
    el: ["Το αυτοκίνητο δεν εγκρίθηκε", "Δεν σας επετράπη να οδηγείτε το {plate}."],
    de: ["Auto nicht freigegeben", "Sie dürfen {plate} nicht fahren."],
    fr: ["Voiture non autorisée", "Vous n'êtes pas autorisé à conduire {plate}."],
    pl: ["Auto niedozwolone", "Nie zezwolono Ci jeździć autem {plate}."],
    he: ["הרכב לא אושר", "לא אישרו לך לעבוד על {plate}."],
    ar: ["لم تتم الموافقة على السيارة", "لم يُسمح لك بالعمل على {plate}."],
  },
  "drv.carApproved": {
    ru: ["Машина одобрена", "{plate} добавлена в ваши машины: меню → Мои машины."],
    en: ["Your car is approved", "{plate} is in your cars: menu → My cars."],
    el: ["Το αυτοκίνητο εγκρίθηκε", "Το {plate} προστέθηκε: μενού → Τα αυτοκίνητά μου."],
    de: ["Ihr Auto ist freigegeben", "{plate} ist bei Ihren Autos: Menü → Meine Autos."],
    fr: ["Votre voiture est validée", "{plate} est dans vos voitures : menu → Mes voitures."],
    pl: ["Auto zatwierdzone", "{plate} jest w Twoich autach: menu → Moje auta."],
    he: ["הרכב אושר", "{plate} נוסף לרכבים שלך: תפריט ← הרכבים שלי."],
    ar: ["تمت الموافقة على سيارتك", "أضيفت {plate} إلى سياراتك: القائمة ← سياراتي."],
  },
  "drv.carReturned": {
    ru: ["Машина: нужны исправления", "{plate}: оператор просит исправить документы. Меню → Мои машины."],
    en: ["Your car: changes needed", "{plate}: the operator asks you to fix the documents. Menu → My cars."],
    el: ["Αυτοκίνητο: χρειάζονται διορθώσεις", "{plate}: ο διαχειριστής ζητά διόρθωση εγγράφων. Μενού → Τα αυτοκίνητά μου."],
    de: ["Ihr Auto: Änderungen nötig", "{plate}: Der Betreiber bittet um Korrektur der Dokumente. Menü → Meine Autos."],
    fr: ["Votre voiture : corrections", "{plate} : l'opérateur demande de corriger les documents. Menu → Mes voitures."],
    pl: ["Auto: potrzebne poprawki", "{plate}: operator prosi o poprawienie dokumentów. Menu → Moje auta."],
    he: ["הרכב: נדרשים תיקונים", "{plate}: המפעיל מבקש לתקן מסמכים. תפריט ← הרכבים שלי."],
    ar: ["سيارتك: مطلوب تصحيح", "{plate}: يطلب المشغّل تصحيح المستندات. القائمة ← سياراتي."],
  },
  "drv.carRefused": {
    ru: ["Машина не одобрена", "Оператор не одобрил {plate}."],
    en: ["Car not approved", "The operator did not approve {plate}."],
    el: ["Το αυτοκίνητο δεν εγκρίθηκε", "Ο διαχειριστής δεν ενέκρινε το {plate}."],
    de: ["Auto nicht freigegeben", "Der Betreiber hat {plate} nicht freigegeben."],
    fr: ["Voiture refusée", "L'opérateur n'a pas validé {plate}."],
    pl: ["Auto niezatwierdzone", "Operator nie zatwierdził auta {plate}."],
    he: ["הרכב לא אושר", "המפעיל לא אישר את {plate}."],
    ar: ["لم تتم الموافقة", "لم يوافق المشغّل على {plate}."],
  },
  "staff.carAsk": {
    ru: ["Запрос на машину", "{who} просит работать на {plate}"],
    en: ["Car access to approve", "{who} asks to drive {plate}"],
    el: ["Αίτημα για αυτοκίνητο", "{who}: αίτημα για {plate}"],
    de: ["Auto-Anfrage", "{who} möchte {plate} fahren"],
    fr: ["Demande de voiture", "{who} demande à conduire {plate}"],
    pl: ["Prośba o auto", "{who} prosi o auto {plate}"],
    he: ["בקשה לרכב", "{who} מבקש לנהוג ב-{plate}"],
    ar: ["طلب سيارة", "{who} يطلب قيادة {plate}"],
  },
  "staff.carNew": {
    ru: ["Новая машина на проверку", "{who}: {plate} — проверить документы"],
    en: ["New car to check", "{who}: {plate} — check the documents"],
    el: ["Νέο αυτοκίνητο για έλεγχο", "{who}: {plate} — έλεγχος εγγράφων"],
    de: ["Neues Auto zu prüfen", "{who}: {plate} — Dokumente prüfen"],
    fr: ["Nouvelle voiture à vérifier", "{who} : {plate} — vérifier les documents"],
    pl: ["Nowe auto do sprawdzenia", "{who}: {plate} — sprawdź dokumenty"],
    he: ["רכב חדש לבדיקה", "{who}: {plate} — לבדוק מסמכים"],
    ar: ["سيارة جديدة للمراجعة", "{who}: {plate} — راجِع المستندات"],
  },
  // Documents of cars added through «Мои машины» (2026-11-24).
  "drv.carDocExpiring": {
    ru: ["Документ машины истекает", "{plate}: {slot} — срок истекает через {days} дн. Загрузите новый: меню → Мои машины."],
    en: ["Car document expiring", "{plate}: {slot} expires in {days} day(s). Upload the new one: menu → My cars."],
    el: ["Έγγραφο αυτοκινήτου λήγει", "{plate}: {slot} — λήγει σε {days} ημ. Ανεβάστε το νέο: μενού → Τα αυτοκίνητά μου."],
    de: ["Autodokument läuft ab", "{plate}: {slot} läuft in {days} Tag(en) ab. Neues hochladen: Menü → Meine Autos."],
    fr: ["Document de voiture bientôt expiré", "{plate} : {slot} expire dans {days} jour(s). Envoyez le nouveau : menu → Mes voitures."],
    pl: ["Dokument auta wygasa", "{plate}: {slot} — wygasa za {days} dn. Wgraj nowy: menu → Moje auta."],
    he: ["מסמך רכב עומד לפוג", "{plate}: {slot} — פג בעוד {days} ימים. העלו חדש: תפריט ← הרכבים שלי."],
    ar: ["مستند سيارة ستنتهي صلاحيته", "{plate}: {slot} — تنتهي خلال {days} يوم. ارفع الجديد: القائمة ← سياراتي."],
  },
  "drv.carDocExpired": {
    ru: ["Документ машины просрочен", "{plate}: {slot} — срок истёк, на этой машине нельзя выйти на линию. Загрузите новый: меню → Мои машины."],
    en: ["Car document expired", "{plate}: {slot} has expired — you can't go online in this car. Upload the new one: menu → My cars."],
    el: ["Έγγραφο αυτοκινήτου έληξε", "{plate}: {slot} — έληξε, δεν μπορείτε να συνδεθείτε με αυτό. Ανεβάστε το νέο: μενού → Τα αυτοκίνητά μου."],
    de: ["Autodokument abgelaufen", "{plate}: {slot} ist abgelaufen — mit diesem Auto nicht online. Neues hochladen: Menü → Meine Autos."],
    fr: ["Document de voiture expiré", "{plate} : {slot} a expiré — impossible de passer en ligne avec cette voiture. Envoyez le nouveau : menu → Mes voitures."],
    pl: ["Dokument auta wygasł", "{plate}: {slot} — wygasł, nie możesz być online tym autem. Wgraj nowy: menu → Moje auta."],
    he: ["מסמך רכב פג", "{plate}: {slot} — פג, אי אפשר להתחבר עם הרכב הזה. העלו חדש: תפריט ← הרכבים שלי."],
    ar: ["انتهت صلاحية مستند السيارة", "{plate}: {slot} — انتهى، لا يمكنك الاتصال بهذه السيارة. ارفع الجديد: القائمة ← سياراتي."],
  },
  'pre.active': {
    ru: ["Предзаказ активен", "Подача в {timeT}: {place}. Выезжайте к месту подачи вовремя."],
    en: ["Pre-booked ride is now active", "Pickup {timeT} at {place}. Head to the pickup in time."],
    el: ["Η προκράτηση είναι ενεργή", "Παραλαβή στις {timeT}: {place}. Ξεκινήστε έγκαιρα για το σημείο παραλαβής."],
    de: ["Vorbestellung ist aktiv", "Abholung um {timeT}: {place}. Fahren Sie rechtzeitig zum Abholort."],
    fr: ["Réservation active", "Prise en charge à {timeT} : {place}. Rendez-vous au point de départ à temps."],
    pl: ["Rezerwacja aktywna", "Odbiór o {timeT}: {place}. Wyrusz na miejsce odbioru na czas."],
    he: ["ההזמנה המוקדמת פעילה", "איסוף ב-{timeT}: {place}. צאו לנקודת האיסוף בזמן."],
    ar: ["الحجز المسبق نشط الآن", "الاستلام في {timeT}: {place}. توجّه إلى نقطة الاستلام في الوقت المحدد."],
  },
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
  'share.liveGuest': {
    ru: ["Водитель едет — поездка с попутчиком", "Подача около {pickT}, на месте около {etaT}. К оплате {payC}."],
    en: ["Driver on the way — shared ride", "Pickup about {pickT}, arrival about {etaT}. You pay {payC}."],
    el: ["Ο οδηγός έρχεται — κοινή διαδρομή", "Παραλαβή περίπου {pickT}, άφιξη περίπου {etaT}. Πληρώνετε {payC}."],
    he: ["הנהג בדרך — נסיעה משותפת", "איסוף בערך {pickT}, הגעה בערך {etaT}. לתשלום {payC}."],
    ar: ["السائق في الطريق — رحلة مشتركة", "الاستلام نحو {pickT}، الوصول نحو {etaT}. المبلغ {payC}."],
    pl: ["Kierowca jedzie — przejazd wspólny", "Odbiór ok. {pickT}, przyjazd ok. {etaT}. Do zapłaty {payC}."],
    de: ["Fahrer unterwegs — geteilte Fahrt", "Abholung ca. {pickT}, Ankunft ca. {etaT}. Sie zahlen {payC}."],
    fr: ["Chauffeur en route — trajet partagé", "Prise en charge vers {pickT}, arrivée vers {etaT}. À payer : {payC}."],
  },
  'share.liveHost': {
    ru: ["К вам подсядет попутчик", "Вы будете на месте около {etaT}. К оплате {payC}."],
    en: ["A co-rider joins your ride", "You arrive about {etaT}. You pay {payC}."],
    el: ["Ένας συνεπιβάτης μπαίνει στη διαδρομή σας", "Φτάνετε περίπου {etaT}. Πληρώνετε {payC}."],
    he: ["נוסע משותף מצטרף לנסיעה שלכם", "תגיעו בערך {etaT}. לתשלום {payC}."],
    ar: ["راكب مشارك ينضم إلى رحلتك", "تصل نحو {etaT}. المبلغ {payC}."],
    pl: ["Do twojego przejazdu dołącza współpasażer", "Będziesz na miejscu ok. {etaT}. Do zapłaty {payC}."],
    de: ["Ein Mitfahrer steigt zu", "Sie sind ca. {etaT} da. Sie zahlen {payC}."],
    fr: ["Un covoyageur rejoint votre trajet", "Vous arrivez vers {etaT}. À payer : {payC}."],
  },
  'share.taken': {
    ru: ["Попутчик", "Этого попутчика уже взял другой водитель."],
    en: ["Co-rider", "Another driver already took this co-rider."],
    el: ["Συνεπιβάτης", "Αυτόν τον συνεπιβάτη τον πήρε ήδη άλλος οδηγός."],
    he: ["נוסע משותף", "נהג אחר כבר לקח את הנוסע הזה."],
    ar: ["راكب مشارك", "أخذ سائق آخر هذا الراكب بالفعل."],
    pl: ["Współpasażer", "Tego współpasażera wziął już inny kierowca."],
    de: ["Mitfahrer", "Ein anderer Fahrer hat diesen Mitfahrer schon übernommen."],
    fr: ["Covoyageur", "Un autre chauffeur a déjà pris ce covoyageur."],
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
  // Finished ride (2026-11-26): what to pay the driver.
  'ride.completed': {
    ru: ["Поездка завершена", "К оплате водителю: {totalC}."],
    en: ["Ride completed", "To pay the driver: {totalC}."],
    el: ["Η διαδρομή ολοκληρώθηκε", "Πληρωμή στον οδηγό: {totalC}."],
    de: ["Fahrt beendet", "An den Fahrer zu zahlen: {totalC}."],
    fr: ["Course terminée", "À payer au chauffeur : {totalC}."],
    pl: ["Przejazd zakończony", "Do zapłaty kierowcy: {totalC}."],
    he: ["הנסיעה הסתיימה", "לתשלום לנהג: {totalC}."],
    ar: ["انتهت الرحلة", "المبلغ المستحق للسائق: {totalC}."],
  },
  'ride.completedNoSum': {
    ru: ["Поездка завершена", "Спасибо, что ездите с IL-Y!"],
    en: ["Ride completed", "Thank you for riding with IL-Y!"],
    el: ["Η διαδρομή ολοκληρώθηκε", "Ευχαριστούμε που ταξιδεύετε με την IL-Y!"],
    de: ["Fahrt beendet", "Danke, dass Sie mit IL-Y fahren!"],
    fr: ["Course terminée", "Merci de voyager avec IL-Y !"],
    pl: ["Przejazd zakończony", "Dziękujemy za przejazd z IL-Y!"],
    he: ["הנסיעה הסתיימה", "תודה שנסעתם עם IL-Y!"],
    ar: ["انتهت الرحلة", "شكرًا لركوبك مع IL-Y!"],
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
  'ride.assignedNext': {
    ru: ["Водитель назначен", "Водитель заканчивает поездку неподалёку и приедет к вам следующим."],
    en: ["Driver assigned", "Your driver is finishing a ride nearby and will come to you next."],
    el: ["Οδηγός ορίστηκε", "Ο οδηγός ολοκληρώνει μια κούρσα κοντά και έρχεται σε εσάς αμέσως μετά."],
    de: ["Fahrer zugewiesen", "Ihr Fahrer beendet in der Nähe eine Fahrt und kommt direkt danach zu Ihnen."],
    fr: ["Chauffeur attribué", "Votre chauffeur termine une course à proximité et viendra vous chercher juste après."],
    pl: ["Kierowca przydzielony", "Kierowca kończy kurs w pobliżu i przyjedzie do Ciebie zaraz potem."],
    he: ["נהג שובץ", "הנהג מסיים נסיעה בקרבת מקום ויגיע אליכם מיד אחריה."],
    ar: ["تم تعيين سائق", "سائقك ينهي رحلة قريبة وسيأتي إليك بعدها مباشرة."],
  },
  'ride.nextOnWay': {
    ru: ["Водитель едет к вам", "Водитель закончил предыдущую поездку и уже едет к вам."],
    en: ["Your driver is on the way", "The driver has finished the previous ride and is heading to you."],
    el: ["Ο οδηγός έρχεται", "Ο οδηγός ολοκλήρωσε την προηγούμενη κούρσα και έρχεται σε εσάς."],
    de: ["Ihr Fahrer ist unterwegs", "Der Fahrer hat die vorige Fahrt beendet und ist auf dem Weg zu Ihnen."],
    fr: ["Votre chauffeur arrive", "Le chauffeur a terminé la course précédente et se dirige vers vous."],
    pl: ["Kierowca jedzie do Ciebie", "Kierowca zakończył poprzedni kurs i jedzie do Ciebie."],
    he: ["הנהג בדרך אליכם", "הנהג סיים את הנסיעה הקודמת ובדרך אליכם."],
    ar: ["السائق في الطريق إليك", "أنهى السائق الرحلة السابقة وهو في طريقه إليك."],
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
  'drv.dropoffChanged': {
    ru: ["Клиент изменил адрес высадки", "Построен новый маршрут."],
    en: ["The passenger changed the destination", "A new route has been built."],
    el: ["Ο επιβάτης άλλαξε τον προορισμό", "Δημιουργήθηκε νέα διαδρομή."],
    de: ["Der Fahrgast hat das Ziel geändert", "Eine neue Route wurde berechnet."],
    fr: ["Le passager a changé la destination", "Un nouvel itinéraire a été calculé."],
    pl: ["Pasażer zmienił cel podróży", "Wyznaczono nową trasę."],
    he: ["הנוסע שינה את היעד", "נבנה מסלול חדש."],
    ar: ["غيّر الراكب الوجهة", "تم إنشاء مسار جديد."],
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
  'drv.rideRemoved': {
    ru: ["Заказ снят с вас", "Диспетчер снял с вас этот заказ. Ехать на подачу не нужно."],
    en: ["Ride removed", "Dispatch took this ride off you. Do not go to the pickup."],
    el: ["Η διαδρομή αφαιρέθηκε", "Η διαδρομή αφαιρέθηκε από εσάς. Μην πάτε στην παραλαβή."],
    de: ["Fahrt entzogen", "Die Zentrale hat Ihnen diese Fahrt entzogen. Nicht zur Abholung fahren."],
    fr: ["Course retirée", "Le dispatch vous a retiré cette course. N’allez pas à la prise en charge."],
    pl: ["Przejazd odebrany", "Dyspozytor odebrał ci ten przejazd. Nie jedź na odbiór."],
    he: ["הנסיעה הוסרה", "המוקד הסיר ממך את הנסיעה. אין צורך לנסוע לאיסוף."],
    ar: ["أُزيلت الرحلة", "أزال المرسل هذه الرحلة منك. لا تذهب إلى نقطة الاستلام."],
  },
  'drv.rideLostGps': {
    ru: ["Заказ передан другому", "Слишком долго не было GPS с вашего телефона — заказ отдан другому водителю."],
    en: ["Ride reassigned", "No location from your phone for too long — the ride was given to another driver."],
    el: ["Η διαδρομή δόθηκε αλλού", "Χωρίς τοποθεσία από το τηλέφωνό σας για πολύ — η διαδρομή δόθηκε σε άλλον οδηγό."],
    de: ["Fahrt neu vergeben", "Zu lange kein Standort von Ihrem Telefon — die Fahrt ging an einen anderen Fahrer."],
    fr: ["Course réattribuée", "Pas de position de votre téléphone depuis trop longtemps — la course a été donnée à un autre chauffeur."],
    pl: ["Przejazd przekazany", "Zbyt długo brak lokalizacji z telefonu — przejazd dostał inny kierowca."],
    he: ["הנסיעה הועברה", "לא התקבל מיקום מהטלפון זמן רב מדי — הנסיעה הועברה לנהג אחר."],
    ar: ["أُعيد إسناد الرحلة", "لم يصل موقع من هاتفك لفترة طويلة — أُعطيت الرحلة لسائق آخر."],
  },
  'drv.tripStopped': {
    ru: ["Поездка остановлена", "Диспетчер остановил эту поездку."],
    en: ["Trip stopped", "Dispatch stopped this trip."],
    el: ["Η διαδρομή διακόπηκε", "Το κέντρο διέκοψε τη διαδρομή."],
    de: ["Fahrt beendet", "Die Zentrale hat diese Fahrt beendet."],
    fr: ["Course arrêtée", "Le dispatch a arrêté cette course."],
    pl: ["Przejazd zatrzymany", "Dyspozytor zatrzymał ten przejazd."],
    he: ["הנסיעה הופסקה", "המוקד הפסיק את הנסיעה."],
    ar: ["أُوقفت الرحلة", "أوقف المرسل هذه الرحلة."],
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
  'drv.preLapsedNoGps': {
    ru: ["Изменение по предзаказу", "Предзаказ передан в автоматический поиск: с вашего телефона не приходило местоположение."],
    en: ["Pre-booked ride update", "Your pre-booked ride was handed to automatic dispatch: no live location from your phone."],
    el: ["Ενημέρωση προκράτησης", "Η προκράτηση πέρασε στην αυτόματη ανάθεση: δεν ερχόταν τοποθεσία από το τηλέφωνό σας."],
    de: ["Änderung der vorbestellten Fahrt", "Ihre vorbestellte Fahrt ging an die automatische Vermittlung: kein aktueller Standort von Ihrem Telefon."],
    fr: ["Mise à jour de la course réservée", "Votre course réservée est passée en attribution automatique : aucune position de votre téléphone."],
    pl: ["Zmiana w rezerwacji", "Przejazd przekazano do automatycznego wyszukiwania: brak lokalizacji z twojego telefonu."],
    he: ["עדכון לנסיעה שהוזמנה מראש", "הנסיעה הועברה לשיבוץ אוטומטי: לא התקבל מיקום מהטלפון שלך."],
    ar: ["تحديث للرحلة المحجوزة", "تم تحويل رحلتك المحجوزة إلى التوزيع التلقائي: لم يصل موقع من هاتفك."],
  },
  'drv.preLapsedFar': {
    ru: ["Изменение по предзаказу", "Предзаказ передан в автоматический поиск: вы были слишком далеко, чтобы успеть к подаче."],
    en: ["Pre-booked ride update", "Your pre-booked ride was handed to automatic dispatch: you were too far from the pickup to make it in time."],
    el: ["Ενημέρωση προκράτησης", "Η προκράτηση πέρασε στην αυτόματη ανάθεση: ήσασταν πολύ μακριά για να προλάβετε."],
    de: ["Änderung der vorbestellten Fahrt", "Ihre vorbestellte Fahrt ging an die automatische Vermittlung: Sie waren zu weit weg, um rechtzeitig da zu sein."],
    fr: ["Mise à jour de la course réservée", "Votre course réservée est passée en attribution automatique : vous étiez trop loin pour arriver à temps."],
    pl: ["Zmiana w rezerwacji", "Przejazd przekazano do automatycznego wyszukiwania: byłeś za daleko, by zdążyć na odbiór."],
    he: ["עדכון לנסיעה שהוזמנה מראש", "הנסיעה הועברה לשיבוץ אוטומטי: היית רחוק מדי כדי להגיע בזמן."],
    ar: ["تحديث للرحلة المحجوزة", "تم تحويل رحلتك المحجوزة إلى التوزيع التلقائي: كنت بعيداً جداً للوصول في الوقت."],
  },
  'drv.preTooLate': {
    ru: ["Предзаказ снят с вас", "Вы не успеваете на предзаказ — он снят с вас и снова в предзаказах."],
    en: ["Pre-booked ride removed", "You cannot make it to the pre-booked ride in time — it was taken off you and is back in the pre-bookings."],
    el: ["Η προκράτηση αφαιρέθηκε", "Δεν προλαβαίνετε την προκράτηση — αφαιρέθηκε από εσάς και είναι ξανά στις προκρατήσεις."],
    de: ["Vorbestellung entzogen", "Sie schaffen die vorbestellte Fahrt nicht rechtzeitig — sie wurde Ihnen entzogen und ist wieder bei den Vorbestellungen."],
    fr: ["Course réservée retirée", "Vous n’arriverez pas à temps pour la course réservée — elle vous a été retirée et est de nouveau dans les réservations."],
    pl: ["Rezerwacja odebrana", "Nie zdążysz na zarezerwowany przejazd — został ci odebrany i wrócił do rezerwacji."],
    he: ["ההזמנה המוקדמת הוסרה", "לא תספיקו להגיע בזמן — הנסיעה הוסרה ממך וחזרה להזמנות המוקדמות."],
    ar: ["أُزيلت الرحلة المحجوزة", "لن تصل في الوقت إلى الرحلة المحجوزة — أُزيلت منك وعادت إلى الحجوزات المسبقة."],
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
// Document names for {slot} in pushes (2026-11-24).
const SLOT_NAME = {
  "ru": {
    "selfie": "селфи",
    "vehicle_front": "фото машины спереди",
    "vehicle_rear": "фото машины сзади",
    "licence_front": "водительское удостоверение",
    "taxi_licence": "лицензия такси",
    "insurance": "страховка",
    "roadworthiness": "техосмотр"
  },
  "en": {
    "selfie": "selfie",
    "vehicle_front": "car photo (front)",
    "vehicle_rear": "car photo (rear)",
    "licence_front": "driving licence",
    "taxi_licence": "taxi licence",
    "insurance": "insurance",
    "roadworthiness": "roadworthiness (MOT)"
  },
  "el": {
    "selfie": "selfie",
    "vehicle_front": "φωτογραφία αυτοκινήτου (μπροστά)",
    "vehicle_rear": "φωτογραφία αυτοκινήτου (πίσω)",
    "licence_front": "δίπλωμα οδήγησης",
    "taxi_licence": "άδεια ταξί",
    "insurance": "ασφάλεια",
    "roadworthiness": "ΜΟΤ"
  },
  "de": {
    "selfie": "Selfie",
    "vehicle_front": "Fahrzeugfoto (vorne)",
    "vehicle_rear": "Fahrzeugfoto (hinten)",
    "licence_front": "Führerschein",
    "taxi_licence": "Taxilizenz",
    "insurance": "Versicherung",
    "roadworthiness": "TÜV (MOT)"
  },
  "fr": {
    "selfie": "selfie",
    "vehicle_front": "photo du véhicule (avant)",
    "vehicle_rear": "photo du véhicule (arrière)",
    "licence_front": "permis de conduire",
    "taxi_licence": "licence de taxi",
    "insurance": "assurance",
    "roadworthiness": "contrôle technique"
  },
  "pl": {
    "selfie": "selfie",
    "vehicle_front": "zdjęcie auta (przód)",
    "vehicle_rear": "zdjęcie auta (tył)",
    "licence_front": "prawo jazdy",
    "taxi_licence": "licencja taxi",
    "insurance": "ubezpieczenie",
    "roadworthiness": "przegląd techniczny"
  },
  "he": {
    "selfie": "סלפי",
    "vehicle_front": "תמונת רכב (חזית)",
    "vehicle_rear": "תמונת רכב (אחור)",
    "licence_front": "רישיון נהיגה",
    "taxi_licence": "רישיון מונית",
    "insurance": "ביטוח",
    "roadworthiness": "טסט"
  },
  "ar": {
    "selfie": "صورة ذاتية",
    "vehicle_front": "صورة السيارة (الأمام)",
    "vehicle_rear": "صورة السيارة (الخلف)",
    "licence_front": "رخصة القيادة",
    "taxi_licence": "رخصة التاكسي",
    "insurance": "التأمين",
    "roadworthiness": "الفحص الفني"
  }
};
function msgText(msg, L) {
  const byLang = msg && MSG_TEXT[msg.k];
  const t = byLang && (byLang[L] || null);
  if (!t) return null;
  const p = msg.p || {};
  const fill = (str) => str.replace(/\{(\w+)\}/g, (_m, k) => {
    const v = p[k];
    if (v == null) return '';
    if (k === 'slot' && typeof v === 'string') return (SLOT_NAME[L] && SLOT_NAME[L][v]) || (SLOT_NAME.en[v]) || v.replace(/_/g, ' ');
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
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1); // «{slot}: …» at the start
  return { title: fill(t[0]), body: cap(fill(t[1])) };
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
      title = `🚕 ${data.title === 'Next ride offer' ? L.next : L.title}`; // next ride while on a trip (2026-11-25)
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
      icon: '/icons/icon-192.png?v=2',
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
