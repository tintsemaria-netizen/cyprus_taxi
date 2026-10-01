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
import enRides from './en/rides';
import elCommon from './el/common';
import elErrors from './el/errors';
import elBooking from './el/booking';
import elTrack from './el/track';
import elAuth from './el/auth';
import elDriver from './el/driver';
import elDriverReg from './el/driverReg';
import elRides from './el/rides';
import ruCommon from './ru/common';
import ruErrors from './ru/errors';
import ruBooking from './ru/booking';
import ruTrack from './ru/track';
import ruAuth from './ru/auth';
import ruDriver from './ru/driver';
import ruDriverReg from './ru/driverReg';
import ruRides from './ru/rides';

const en = {
  common: enCommon,
  errors: enErrors,
  booking: enBooking,
  track: enTrack,
  auth: enAuth,
  driver: enDriver,
  driverReg: enDriverReg,
  rides: enRides,
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
  rides: elRides,
};
const ru: Catalog<Messages> = {
  common: ruCommon,
  errors: ruErrors,
  booking: ruBooking,
  track: ruTrack,
  auth: ruAuth,
  driver: ruDriver,
  driverReg: ruDriverReg,
  rides: ruRides,
};

export const MESSAGES: Record<Locale, Catalog<Messages>> = { en, el, ru };
