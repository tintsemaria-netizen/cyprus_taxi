// Message catalogs. Each screen group owns a namespace file per locale (en is the source of truth;
// el/ru are typed against it). Register new namespaces in all three objects below.
import type { Locale } from '../config';
import type { Catalog } from '../types';
import enCommon from './en/common';
import enErrors from './en/errors';
import enBooking from './en/booking';
import enTrack from './en/track';
import enAuth from './en/auth';
import enDriver from './en/driver';
import enDriverReg from './en/driverReg';
import enPromo from './en/promo';
import enRides from './en/rides';
import enStaff from './en/staff';
import elCommon from './el/common';
import elErrors from './el/errors';
import elBooking from './el/booking';
import elTrack from './el/track';
import elAuth from './el/auth';
import elDriver from './el/driver';
import elDriverReg from './el/driverReg';
import elPromo from './el/promo';
import elRides from './el/rides';
import elStaff from './el/staff';
import ruCommon from './ru/common';
import ruErrors from './ru/errors';
import ruBooking from './ru/booking';
import ruTrack from './ru/track';
import ruAuth from './ru/auth';
import ruDriver from './ru/driver';
import ruDriverReg from './ru/driverReg';
import ruPromo from './ru/promo';
import ruRides from './ru/rides';
import ruStaff from './ru/staff';
import heCommon from './he/common';
import heErrors from './he/errors';
import heBooking from './he/booking';
import heTrack from './he/track';
import heAuth from './he/auth';
import heDriver from './he/driver';
import heDriverReg from './he/driverReg';
import hePromo from './he/promo';
import heRides from './he/rides';
import arCommon from './ar/common';
import arErrors from './ar/errors';
import arBooking from './ar/booking';
import arTrack from './ar/track';
import arAuth from './ar/auth';
import arDriver from './ar/driver';
import arDriverReg from './ar/driverReg';
import arPromo from './ar/promo';
import arRides from './ar/rides';
import plCommon from './pl/common';
import plErrors from './pl/errors';
import plBooking from './pl/booking';
import plTrack from './pl/track';
import plAuth from './pl/auth';
import plDriver from './pl/driver';
import plDriverReg from './pl/driverReg';
import plPromo from './pl/promo';
import plRides from './pl/rides';
import deCommon from './de/common';
import deErrors from './de/errors';
import deBooking from './de/booking';
import deTrack from './de/track';
import deAuth from './de/auth';
import deDriver from './de/driver';
import deDriverReg from './de/driverReg';
import dePromo from './de/promo';
import deRides from './de/rides';
import frCommon from './fr/common';
import frErrors from './fr/errors';
import frBooking from './fr/booking';
import frTrack from './fr/track';
import frAuth from './fr/auth';
import frDriver from './fr/driver';
import frDriverReg from './fr/driverReg';
import frPromo from './fr/promo';
import frRides from './fr/rides';

import enShare from './en/share';
import elShare from './el/share';
import ruShare from './ru/share';
import heShare from './he/share';
import arShare from './ar/share';
import plShare from './pl/share';
import deShare from './de/share';
import frShare from './fr/share';

const en = {
  common: enCommon,
  errors: enErrors,
  booking: enBooking,
  track: enTrack,
  auth: enAuth,
  driver: enDriver,
  driverReg: enDriverReg,
  promo: enPromo,
  rides: enRides,
  staff: enStaff,
  share: enShare,
};
export type Messages = typeof en;

const el: Catalog<Messages> = {
  common: elCommon,
  errors: elErrors,
  booking: elBooking,
  track: elTrack,
  auth: elAuth,
  driver: elDriver,
  driverReg: elDriverReg,
  promo: elPromo,
  rides: elRides,
  staff: elStaff,
  share: elShare,
};
const ru: Catalog<Messages> = {
  common: ruCommon,
  errors: ruErrors,
  booking: ruBooking,
  track: ruTrack,
  auth: ruAuth,
  driver: ruDriver,
  driverReg: ruDriverReg,
  promo: ruPromo,
  rides: ruRides,
  staff: ruStaff,
  share: ruShare,
};

// Staff/admin panel stays English for he (internal tool).
const he: Catalog<Messages> = {
  common: heCommon,
  errors: heErrors,
  booking: heBooking,
  track: heTrack,
  auth: heAuth,
  driver: heDriver,
  driverReg: heDriverReg,
  promo: hePromo,
  rides: heRides,
  staff: enStaff,
  share: heShare,
};
// Staff/admin panel stays English for ar (internal tool).
const ar: Catalog<Messages> = {
  common: arCommon,
  errors: arErrors,
  booking: arBooking,
  track: arTrack,
  auth: arAuth,
  driver: arDriver,
  driverReg: arDriverReg,
  promo: arPromo,
  rides: arRides,
  staff: enStaff,
  share: arShare,
};
// Staff/admin panel stays English for pl (internal tool).
const pl: Catalog<Messages> = {
  common: plCommon,
  errors: plErrors,
  booking: plBooking,
  track: plTrack,
  auth: plAuth,
  driver: plDriver,
  driverReg: plDriverReg,
  promo: plPromo,
  rides: plRides,
  staff: enStaff,
  share: plShare,
};
// Staff/admin panel stays English for de (internal tool).
const de: Catalog<Messages> = {
  common: deCommon,
  errors: deErrors,
  booking: deBooking,
  track: deTrack,
  auth: deAuth,
  driver: deDriver,
  driverReg: deDriverReg,
  promo: dePromo,
  rides: deRides,
  staff: enStaff,
  share: deShare,
};
// Staff/admin panel stays English for fr (internal tool).
const fr: Catalog<Messages> = {
  common: frCommon,
  errors: frErrors,
  booking: frBooking,
  track: frTrack,
  auth: frAuth,
  driver: frDriver,
  driverReg: frDriverReg,
  promo: frPromo,
  rides: frRides,
  staff: enStaff,
  share: frShare,
};

export const MESSAGES: Record<Locale, Catalog<Messages>> = { en, el, ru, he, ar, pl, de, fr };
