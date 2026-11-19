// Feature switches shared by server and browser code.

/**
 * Passenger SMS codes (sign-in by phone, phone check at sign-up). Turned OFF on 2026-11-19 at the
 * operator's request while testing: passengers sign up / sign in with email + password only, and a
 * phone given at sign-up is not sent a code. Set back to `true` to bring SMS for passengers back.
 * Drivers are not affected (their phone sign-in stays as it is).
 */
export const PASSENGER_SMS = false;
