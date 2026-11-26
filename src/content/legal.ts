// Privacy policy and service terms (2026-11-26, «готовность к App Store»). English is the reference text; Russian and
// Greek are translations; the other 5 languages show English with a note. The operator's name, address and contacts
// come from admin «Настройки» (operatorName / operatorAddress / supportEmail / supportPhone).
// DRAFT FOR LEGAL REVIEW: written from how the app actually works; a Cyprus lawyer should check it before launch.

export type LegalLang = 'en' | 'ru' | 'el';
export interface LegalVars { op: string; addr: string; email: string; phone: string }
export interface LegalDoc { title: string; updated: string; sections: { h: string; p: string[] }[] }

export const LEGAL_UPDATED = '2026-11-26';

function fill(s: string, v: LegalVars) {
  return s.replace(/\{op\}/g, v.op).replace(/\{addr\}/g, v.addr).replace(/\{email\}/g, v.email).replace(/\{phone\}/g, v.phone);
}
function doc(d: LegalDoc, v: LegalVars): LegalDoc {
  return { ...d, sections: d.sections.map((s) => ({ h: s.h, p: s.p.map((x) => fill(x, v)) })) };
}

const PRIVACY: Record<LegalLang, LegalDoc> = {
  en: {
    title: 'Privacy policy',
    updated: 'Last updated',
    sections: [
      { h: '1. Who we are', p: ['IL-Y is a taxi booking service in Cyprus operated by {op}, {addr} ("we"). We are the controller of the personal data described here. Contact: {email}, {phone}.'] },
      { h: '2. What we collect', p: [
        'Passengers: phone number (to sign in), name, e-mail if you give it (for receipts), saved places, your bookings (pickup, stops and destination, time, car class, number of passengers, notes), messages you send to your driver, ratings and receipts.',
        'Your location: the app uses your phone\'s location to show you on the map and to suggest the pickup. It is shared with your driver only if you switch on "Show the driver where I am", and only until pickup; it is deleted when you switch it off, at pickup, at the end of the ride, or after 5 minutes without updates.',
        'Drivers: name, contacts, the registration application (identity, driving licence, taxi licence and vehicle data and documents), GPS position while on duty, rides, earnings and settlements.',
        'Technical data: a session cookie that keeps you signed in, your language, push-notification subscriptions, and technical logs for security.',
      ] },
      { h: '3. Why we use it', p: [
        'To take and carry out your booking: find a driver, show the route, price and arrival time, let you and the driver contact each other, send receipts (performance of a contract).',
        'For safety, preventing misuse and fixing problems (our legitimate interests).',
        'To keep accounting and tax records (legal obligation).',
        'We do not sell personal data and we do not use advertising trackers.',
      ] },
      { h: '4. Who receives it', p: [
        'Your driver sees what is needed for the ride: pickup and destination, your name, the number of passengers, notes and a phone number to contact you. Passengers see the driver\'s first name, car and plate and the car on the map.',
        'Service providers who work for us: server hosting, Google Maps (maps, addresses, routes), an SMS provider for sign-in codes, an e-mail provider for receipts, the push services of your browser or phone, and — when card payment is introduced — a payment provider. Authorities, when the law requires it.',
        'Some providers are outside the EU (for example in the USA). Such transfers are covered by the European Commission\'s Standard Contractual Clauses or an adequacy decision.',
      ] },
      { h: '5. How long we keep it', p: [
        'Your account: until you delete it. Rides and fares: as long as Cyprus tax and accounting law requires; after you delete your account they no longer identify you.',
        'A driver\'s latest position is removed within 24 hours after the end of duty. Technical logs: up to 90 days.',
      ] },
      { h: '6. Your rights', p: [
        'You can see, download and correct your data, and delete your account at any time in the app (Profile settings → Personal details). You can also object to or restrict processing and withdraw any consent. Write to {email}.',
        'You may complain to the Commissioner for Personal Data Protection of Cyprus (www.dataprotection.gov.cy).',
      ] },
      { h: '7. Children', p: ['The service is not meant for children under 16 booking on their own. A parent or guardian may book a ride for them.'] },
      { h: '8. Changes', p: ['If we change this policy we will publish the new version here with its date and tell you in the app about important changes.'] },
    ],
  },
  ru: {
    title: 'Политика конфиденциальности',
    updated: 'Обновлено',
    sections: [
      { h: '1. Кто мы', p: ['IL-Y — сервис заказа такси на Кипре. Оператор — {op}, {addr} («мы»). Мы отвечаем за обработку персональных данных, описанных здесь. Контакты: {email}, {phone}.'] },
      { h: '2. Что мы собираем', p: [
        'Клиенты: номер телефона (для входа), имя, e-mail, если вы его укажете (для чеков), сохранённые места, ваши заказы (подача, остановки и пункт назначения, время, класс машины, число пассажиров, комментарии), сообщения водителю, оценки и чеки.',
        'Ваше местоположение: приложение использует геолокацию телефона, чтобы показать вас на карте и предложить место подачи. Водителю оно передаётся, только если вы включили «Показать водителю, где я», и только до посадки; удаляется, когда вы это выключите, при посадке, в конце поездки или через 5 минут без обновлений.',
        'Водители: имя, контакты, анкета регистрации (данные и документы личности, прав, лицензии такси и машины), местоположение во время работы на линии, поездки, заработок и расчёты.',
        'Технические данные: файл cookie, который сохраняет вход, выбранный язык, подписки на уведомления и технические журналы для безопасности.',
      ] },
      { h: '3. Зачем мы их используем', p: [
        'Чтобы принять и выполнить заказ: найти водителя, показать маршрут, цену и время подачи, дать вам и водителю связаться, отправить чек (исполнение договора).',
        'Для безопасности, защиты от злоупотреблений и исправления ошибок (наш законный интерес).',
        'Для бухгалтерского и налогового учёта (обязанность по закону).',
        'Мы не продаём персональные данные и не используем рекламные трекеры.',
      ] },
      { h: '4. Кто их получает', p: [
        'Водитель видит то, что нужно для поездки: подачу и пункт назначения, ваше имя, число пассажиров, комментарии и телефон для связи. Клиент видит имя водителя, машину и номер, а также машину на карте.',
        'Поставщики услуг, которые работают на нас: хостинг сервера, Google Maps (карты, адреса, маршруты), SMS-сервис для кодов входа, почтовый сервис для чеков, сервисы уведомлений вашего браузера или телефона, а с введением оплаты картой — платёжный сервис. Государственные органы — когда этого требует закон.',
        'Некоторые поставщики находятся вне ЕС (например, в США). Такая передача защищена Стандартными договорными условиями Европейской комиссии или решением о достаточном уровне защиты.',
      ] },
      { h: '5. Сколько мы их храним', p: [
        'Аккаунт — пока вы его не удалите. Поездки и оплаты — столько, сколько требует налоговое и бухгалтерское законодательство Кипра; после удаления аккаунта они вас больше не идентифицируют.',
        'Последнее местоположение водителя удаляется в течение 24 часов после окончания работы на линии. Технические журналы — до 90 дней.',
      ] },
      { h: '6. Ваши права', p: [
        'Вы можете посмотреть, скачать и исправить свои данные и в любой момент удалить аккаунт в приложении (Настройки профиля → Личные данные). Вы также можете возразить против обработки или ограничить её и отозвать согласие. Пишите на {email}.',
        'Вы можете подать жалобу Уполномоченному по защите персональных данных Кипра (www.dataprotection.gov.cy).',
      ] },
      { h: '7. Дети', p: ['Сервис не предназначен для самостоятельного заказа детьми младше 16 лет. Родитель или опекун может заказать поездку для ребёнка.'] },
      { h: '8. Изменения', p: ['Если мы изменим эту политику, новая версия с датой появится здесь, а о важных изменениях мы сообщим в приложении.'] },
    ],
  },
  el: {
    title: 'Πολιτική απορρήτου',
    updated: 'Τελευταία ενημέρωση',
    sections: [
      { h: '1. Ποιοι είμαστε', p: ['Το IL-Y είναι υπηρεσία κράτησης ταξί στην Κύπρο, που λειτουργεί από {op}, {addr} («εμείς»). Είμαστε ο υπεύθυνος επεξεργασίας των δεδομένων που περιγράφονται εδώ. Επικοινωνία: {email}, {phone}.'] },
      { h: '2. Τι συλλέγουμε', p: [
        'Επιβάτες: αριθμό τηλεφώνου (για σύνδεση), όνομα, e-mail αν το δώσετε (για αποδείξεις), αποθηκευμένα μέρη, τις κρατήσεις σας (παραλαβή, στάσεις και προορισμό, ώρα, κατηγορία αυτοκινήτου, αριθμό επιβατών, σημειώσεις), μηνύματα προς τον οδηγό, αξιολογήσεις και αποδείξεις.',
        'Η τοποθεσία σας: η εφαρμογή χρησιμοποιεί την τοποθεσία του τηλεφώνου σας για να σας δείξει στον χάρτη και να προτείνει σημείο παραλαβής. Δίνεται στον οδηγό μόνο αν ενεργοποιήσετε το «Δείξε στον οδηγό πού είμαι» και μόνο μέχρι την παραλαβή· διαγράφεται όταν το απενεργοποιήσετε, στην παραλαβή, στο τέλος της διαδρομής ή μετά από 5 λεπτά χωρίς ενημέρωση.',
        'Οδηγοί: όνομα, στοιχεία επικοινωνίας, η αίτηση εγγραφής (στοιχεία και έγγραφα ταυτότητας, διπλώματος, άδειας ταξί και οχήματος), θέση GPS κατά τη βάρδια, διαδρομές, έσοδα και εκκαθαρίσεις.',
        'Τεχνικά δεδομένα: ένα cookie σύνδεσης, η γλώσσα σας, συνδρομές ειδοποιήσεων και τεχνικά αρχεία καταγραφής για ασφάλεια.',
      ] },
      { h: '3. Γιατί τα χρησιμοποιούμε', p: [
        'Για να δεχτούμε και να εκτελέσουμε την κράτησή σας: εύρεση οδηγού, διαδρομή, τιμή και ώρα άφιξης, επικοινωνία με τον οδηγό, αποστολή απόδειξης (εκτέλεση σύμβασης).',
        'Για ασφάλεια, αποτροπή κατάχρησης και διόρθωση προβλημάτων (έννομο συμφέρον μας).',
        'Για λογιστικά και φορολογικά αρχεία (νομική υποχρέωση).',
        'Δεν πουλάμε προσωπικά δεδομένα και δεν χρησιμοποιούμε διαφημιστικούς ιχνηλάτες.',
      ] },
      { h: '4. Ποιος τα λαμβάνει', p: [
        'Ο οδηγός σας βλέπει ό,τι χρειάζεται για τη διαδρομή: παραλαβή και προορισμό, το όνομά σας, αριθμό επιβατών, σημειώσεις και τηλέφωνο επικοινωνίας. Οι επιβάτες βλέπουν το όνομα του οδηγού, το αυτοκίνητο, τον αριθμό κυκλοφορίας και το αυτοκίνητο στον χάρτη.',
        'Πάροχοι που εργάζονται για εμάς: φιλοξενία διακομιστή, Google Maps (χάρτες, διευθύνσεις, διαδρομές), πάροχος SMS για κωδικούς σύνδεσης, πάροχος e-mail για αποδείξεις, υπηρεσίες ειδοποιήσεων του προγράμματος περιήγησης ή του τηλεφώνου σας και — όταν εισαχθεί η πληρωμή με κάρτα — πάροχος πληρωμών. Αρχές, όταν το απαιτεί ο νόμος.',
        'Ορισμένοι πάροχοι βρίσκονται εκτός ΕΕ (π.χ. στις ΗΠΑ). Οι διαβιβάσεις αυτές καλύπτονται από τις Τυποποιημένες Συμβατικές Ρήτρες της Ευρωπαϊκής Επιτροπής ή απόφαση επάρκειας.',
      ] },
      { h: '5. Πόσο καιρό τα κρατάμε', p: [
        'Ο λογαριασμός σας: μέχρι να τον διαγράψετε. Διαδρομές και ναύλοι: όσο απαιτεί η κυπριακή φορολογική και λογιστική νομοθεσία· μετά τη διαγραφή του λογαριασμού δεν σας ταυτοποιούν πλέον.',
        'Η τελευταία θέση του οδηγού διαγράφεται εντός 24 ωρών από το τέλος της βάρδιας. Τεχνικά αρχεία: έως 90 ημέρες.',
      ] },
      { h: '6. Τα δικαιώματά σας', p: [
        'Μπορείτε να δείτε, να κατεβάσετε και να διορθώσετε τα δεδομένα σας και να διαγράψετε τον λογαριασμό σας ανά πάσα στιγμή στην εφαρμογή (Ρυθμίσεις προφίλ → Προσωπικά στοιχεία). Μπορείτε επίσης να αντιταχθείτε ή να περιορίσετε την επεξεργασία και να ανακαλέσετε συγκατάθεση. Γράψτε στο {email}.',
        'Μπορείτε να υποβάλετε καταγγελία στον Επίτροπο Προστασίας Δεδομένων Προσωπικού Χαρακτήρα της Κύπρου (www.dataprotection.gov.cy).',
      ] },
      { h: '7. Παιδιά', p: ['Η υπηρεσία δεν προορίζεται για παιδιά κάτω των 16 που κάνουν κράτηση μόνα τους. Γονέας ή κηδεμόνας μπορεί να κλείσει διαδρομή για αυτά.'] },
      { h: '8. Αλλαγές', p: ['Αν αλλάξουμε αυτή την πολιτική, θα δημοσιεύσουμε τη νέα έκδοση εδώ με την ημερομηνία της και θα σας ενημερώσουμε στην εφαρμογή για σημαντικές αλλαγές.'] },
    ],
  },
};

const TERMS: Record<LegalLang, LegalDoc> = {
  en: {
    title: 'Terms of service',
    updated: 'Last updated',
    sections: [
      { h: '1. The service', p: ['IL-Y, operated by {op}, {addr}, is an app that connects passengers with licensed taxi drivers in Cyprus. The ride itself is provided by the driver; we arrange the booking, match a driver, and show the price, the route and the car.'] },
      { h: '2. Booking', p: [
        'You book a ride now or in advance. A ride now goes to a nearby driver who accepts it. A pre-booking is confirmed when a driver takes it; if none does, we tell you.',
        'Please give a correct pickup, the number of passengers and your luggage, and be at the pickup on time.',
      ] },
      { h: '3. Prices', p: [
        'Before you book you see a price range. The final amount is set by the taximeter under the regulated Cyprus tariff, unless a fixed price is shown (for example airport ↔ your area), in which case you pay exactly that price.',
        'Co-rider ("Попутчик"): if a co-rider is found and actually travels with you, you pay the shown co-rider price (30% less); otherwise the normal price applies. Waiting beyond the free minutes and extra stops may be charged as shown in the app.',
      ] },
      { h: '4. Payment', p: ['You pay the driver directly, in cash or by card if the driver accepts it, unless the app offers payment in the app. You receive a receipt in the app and, if you gave your e-mail, by e-mail.'] },
      { h: '5. Cancelling and no-show', p: ['You can cancel in the app. If you do not come to a confirmed pre-booked co-rider ride, a no-show fee shown in the app when booking may apply (never more than the ride price).'] },
      { h: '6. Behaviour', p: ['Be respectful to drivers and passengers. We may limit or close an account after abuse, fraud, damage or repeated no-shows. Drivers may refuse a ride when the law allows.'] },
      { h: '7. Liability', p: ['The driver is responsible for the ride and the vehicle under Cyprus taxi rules. We do our best to keep the app working but cannot guarantee that a driver is always available. Nothing in these terms limits rights you have under consumer law.'] },
      { h: '8. Complaints', p: ['Write to {email} or call {phone}. We answer within 14 days. EU consumers may also use the EU online dispute resolution platform.'] },
      { h: '9. Law and changes', p: ['These terms are governed by the law of the Republic of Cyprus. If we change them we will publish the new version here with its date.'] },
    ],
  },
  ru: {
    title: 'Условия сервиса',
    updated: 'Обновлено',
    sections: [
      { h: '1. Сервис', p: ['IL-Y (оператор — {op}, {addr}) — приложение, которое соединяет клиентов с лицензированными водителями такси на Кипре. Саму поездку выполняет водитель; мы принимаем заказ, подбираем водителя и показываем цену, маршрут и машину.'] },
      { h: '2. Заказ', p: [
        'Вы заказываете поездку сейчас или заранее. Заказ «сейчас» уходит водителю рядом, который его принимает. Предзаказ подтверждается, когда его берёт водитель; если никто не возьмёт, мы сообщим.',
        'Укажите правильное место подачи, число пассажиров и багаж и будьте на месте вовремя.',
      ] },
      { h: '3. Цены', p: [
        'До заказа вы видите вилку цены. Итоговую сумму показывает таксометр по регулируемому тарифу Кипра, кроме случаев, когда показана фиксированная цена (например, аэропорт ↔ ваш район): тогда вы платите ровно её.',
        'Попутчик: если попутчик найден и действительно едет с вами, вы платите показанную цену с попутчиком (на 30% меньше); иначе — обычную. Ожидание сверх бесплатных минут и дополнительные остановки могут оплачиваться, как показано в приложении.',
      ] },
      { h: '4. Оплата', p: ['Вы платите водителю напрямую — наличными или картой, если водитель её принимает, — если приложение не предлагает оплату в приложении. Чек приходит в приложении и, если вы указали e-mail, на почту.'] },
      { h: '5. Отмена и неявка', p: ['Отменить заказ можно в приложении. Если вы не пришли на подтверждённую предзаказанную поездку с попутчиком, может взиматься штраф за неявку, указанный в приложении при заказе (не больше цены поездки).'] },
      { h: '6. Поведение', p: ['Уважайте водителей и пассажиров. Мы можем ограничить или закрыть аккаунт за оскорбления, мошенничество, ущерб или повторные неявки. Водитель может отказать в поездке, если это допускает закон.'] },
      { h: '7. Ответственность', p: ['За поездку и машину по правилам такси Кипра отвечает водитель. Мы стараемся, чтобы приложение работало, но не можем гарантировать, что свободный водитель есть всегда. Ничто в этих условиях не ограничивает ваши права по закону о защите прав потребителей.'] },
      { h: '8. Жалобы', p: ['Пишите на {email} или звоните {phone}. Мы отвечаем в течение 14 дней. Потребители ЕС могут также воспользоваться европейской платформой онлайн-урегулирования споров.'] },
      { h: '9. Право и изменения', p: ['Эти условия регулируются законодательством Республики Кипр. Если мы их изменим, новая версия с датой появится здесь.'] },
    ],
  },
  el: {
    title: 'Όροι υπηρεσίας',
    updated: 'Τελευταία ενημέρωση',
    sections: [
      { h: '1. Η υπηρεσία', p: ['Το IL-Y, που λειτουργεί από {op}, {addr}, είναι εφαρμογή που συνδέει επιβάτες με αδειούχους οδηγούς ταξί στην Κύπρο. Τη διαδρομή εκτελεί ο οδηγός· εμείς δεχόμαστε την κράτηση, βρίσκουμε οδηγό και δείχνουμε την τιμή, τη διαδρομή και το αυτοκίνητο.'] },
      { h: '2. Κράτηση', p: [
        'Κλείνετε διαδρομή τώρα ή από πριν. Η διαδρομή «τώρα» πηγαίνει σε κοντινό οδηγό που τη δέχεται. Η κράτηση από πριν επιβεβαιώνεται όταν την αναλάβει οδηγός· αν δεν την αναλάβει κανείς, σας ενημερώνουμε.',
        'Δώστε σωστό σημείο παραλαβής, αριθμό επιβατών και αποσκευές και να είστε στο σημείο εγκαίρως.',
      ] },
      { h: '3. Τιμές', p: [
        'Πριν την κράτηση βλέπετε εύρος τιμής. Το τελικό ποσό ορίζει το ταξίμετρο με το ρυθμιζόμενο κυπριακό τιμολόγιο, εκτός αν εμφανίζεται σταθερή τιμή (π.χ. αεροδρόμιο ↔ η περιοχή σας), οπότε πληρώνετε ακριβώς αυτή.',
        'Συνεπιβάτης: αν βρεθεί συνεπιβάτης και ταξιδέψει πράγματι μαζί σας, πληρώνετε την τιμή με συνεπιβάτη (30% λιγότερο)· αλλιώς ισχύει η κανονική τιμή. Η αναμονή πέρα από τα δωρεάν λεπτά και οι επιπλέον στάσεις μπορεί να χρεωθούν όπως φαίνεται στην εφαρμογή.',
      ] },
      { h: '4. Πληρωμή', p: ['Πληρώνετε απευθείας τον οδηγό, με μετρητά ή κάρτα αν τη δέχεται, εκτός αν η εφαρμογή προσφέρει πληρωμή μέσα σε αυτήν. Η απόδειξη έρχεται στην εφαρμογή και, αν δώσατε e-mail, με e-mail.'] },
      { h: '5. Ακύρωση και μη εμφάνιση', p: ['Μπορείτε να ακυρώσετε στην εφαρμογή. Αν δεν εμφανιστείτε σε επιβεβαιωμένη κράτηση με συνεπιβάτη, μπορεί να ισχύσει χρέωση μη εμφάνισης που φαίνεται κατά την κράτηση (ποτέ πάνω από την τιμή της διαδρομής).'] },
      { h: '6. Συμπεριφορά', p: ['Σεβαστείτε οδηγούς και επιβάτες. Μπορούμε να περιορίσουμε ή να κλείσουμε λογαριασμό μετά από προσβολές, απάτη, ζημιά ή επανειλημμένες μη εμφανίσεις. Οι οδηγοί μπορούν να αρνηθούν διαδρομή όπου το επιτρέπει ο νόμος.'] },
      { h: '7. Ευθύνη', p: ['Για τη διαδρομή και το όχημα ευθύνεται ο οδηγός σύμφωνα με τους κανόνες ταξί της Κύπρου. Κάνουμε ό,τι μπορούμε ώστε η εφαρμογή να λειτουργεί, αλλά δεν μπορούμε να εγγυηθούμε ότι υπάρχει πάντα διαθέσιμος οδηγός. Τίποτα σε αυτούς τους όρους δεν περιορίζει τα δικαιώματά σας ως καταναλωτή.'] },
      { h: '8. Παράπονα', p: ['Γράψτε στο {email} ή καλέστε στο {phone}. Απαντάμε εντός 14 ημερών. Οι καταναλωτές της ΕΕ μπορούν επίσης να χρησιμοποιήσουν την ευρωπαϊκή πλατφόρμα επίλυσης διαφορών.'] },
      { h: '9. Δίκαιο και αλλαγές', p: ['Οι όροι διέπονται από το δίκαιο της Κυπριακής Δημοκρατίας. Αν τους αλλάξουμε, θα δημοσιεύσουμε τη νέα έκδοση εδώ με την ημερομηνία της.'] },
    ],
  },
};

export function legalDoc(kind: 'privacy' | 'terms', lang: string, v: LegalVars): { doc: LegalDoc; lang: LegalLang } {
  const l: LegalLang = lang === 'ru' || lang === 'el' ? lang : 'en';
  return { doc: doc((kind === 'privacy' ? PRIVACY : TERMS)[l], v), lang: l };
}
