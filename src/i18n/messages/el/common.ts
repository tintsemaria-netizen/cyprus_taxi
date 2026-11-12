import type { Catalog } from '../../types';
import type en from '../en/common';

const common: Catalog<typeof en> = {
  brandTagline: 'Κλείστε διαδρομή σε όλη την Κύπρο',
  book: 'Κράτηση',
  cancel: 'Ακύρωση',
  close: 'Κλείσιμο',
  back: 'Πίσω',
  retry: 'Δοκιμάστε ξανά',
  loading: 'Φόρτωση…',
  pleaseWait: 'Παρακαλώ περιμένετε…',
  signOut: 'Αποσύνδεση',
  myTrip: 'Η διαδρομή μου',
  language: 'Γλώσσα',
  networkError: 'Πρόβλημα δικτύου — ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.',
  somethingWrong: 'Κάτι πήγε στραβά. Δοκιμάστε ξανά.',
  emergency112: 'Σε έκτακτη ανάγκη καλέστε το 112.',
  passengers: { one: '{count} επιβάτης', other: '{count} επιβάτες' },
  minutes: { one: '{count} λεπτό', other: '{count} λεπτά' },
  status: {
    REQUESTED: 'Προγραμματισμένη διαδρομή',
    SEARCHING: 'Αναζητούμε οδηγό',
    NO_DRIVER: 'Δεν υπάρχουν διαθέσιμοι οδηγοί',
    ASSIGNED: 'Ο οδηγός ορίστηκε',
    EN_ROUTE: 'Ο οδηγός έρχεται',
    ARRIVED: 'Ο οδηγός έφτασε',
    IN_PROGRESS: 'Σε διαδρομή',
    COMPLETED: 'Η διαδρομή ολοκληρώθηκε',
    CANCELED: 'Η κράτηση ακυρώθηκε',
  },
  vClass: { COMFORT: 'Comfort', XL: 'XL' },
  payment: { CASH_TO_DRIVER: 'Μετρητά στον οδηγό' },
  install: {
    title: 'Εγκαταστήστε το IL-Y στο κινητό σας',
    titleDriver: 'Εγκαταστήστε το IL-Y Driver στο κινητό σας',
    androidBody: 'Ανοίγει σε πλήρη οθόνη σαν εφαρμογή και μπορεί να σας στέλνει ειδοποιήσεις για τις διαδρομές.',
    iosSteps: 'Πατήστε «Κοινοποίηση» (το τετράγωνο με το βέλος) στο Safari και μετά «Προσθήκη στην οθόνη Αφετηρίας».',
    install: 'Εγκατάσταση',
    notNow: 'Όχι τώρα',
    iosNotify: 'Για ειδοποιήσεις στο iPhone, προσθέστε το IL-Y στην οθόνη Αφετηρίας (Κοινοποίηση → Προσθήκη στην οθόνη Αφετηρίας) και ανοίγετέ το από εκεί.',
  },
};
export default common;
