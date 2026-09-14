# Task 014 — Passenger login/registration + account-based ride history

> The original attached Task 014 spec did not reach the repository; this file records the
> scope implemented from the owner's instruction: "mandatory passenger login/registration
> after route selection and account-based destination history."

STATUS (2026-09-14): IMPLEMENTED + deployed (release 31d5781). Live-verified. vitest 78/78.

## Implemented
- **Passenger account** (`Passenger` + `PassengerSession`, verified phone) via SMS OTP
  (`/api/v1/passenger/otp/{request,verify}`, `/me`, `/logout`). Separate from staff/driver/
  applicant identities.
- **Mandatory login/registration after route selection**: `POST /api/v1/bookings` now requires
  a signed-in passenger (`401 LOGIN_REQUIRED` otherwise) — verified live. The booking flow opens
  a login/registration modal once the route is chosen, then resumes the request. The verified
  account phone is authoritative and the booking is linked to `passengerId`.
- **Account-based ride history**: "My rides" page (`/rides`) lists the passenger's own bookings
  (scoped to the session) with status, fare estimate, and "Track live" (mints a fresh tracking
  grant for an active ride). `GET /api/v1/passenger/rides`, `/rides/[id]/track`.
- **Destination history**: recent distinct destinations from the account's past bookings, offered
  as quick-pick chips under the "To" field. `GET /api/v1/passenger/destinations`.
- Nav "Staff"→"Login"; "My ride"→"My rides".

## Blocker (shared with Task 015)
- Passenger phone verification uses SMS OTP; **real SMS requires TWILIO_ACCOUNT_SID +
  TWILIO_AUTH_TOKEN** (only the Verify Service SID is configured). Until then the beta runs a
  clearly-labelled **"Test verification (SMS not configured)"** dev OTP (enabled via
  `SMS_ALLOW_DEV_OTP`), which is NOT real verification and is not the default.

## Not done
- Optional email/marketing preferences; saved named places (only recent-destination history is
  implemented); a dedicated Account settings page (login/history are covered).
