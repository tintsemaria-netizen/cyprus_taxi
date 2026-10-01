# Task 020 — Post-trip rating & feedback

> STATUS: DONE (code + tests). Closes a core ride-hailing gap: after a trip COMPLETEs, the owning
> passenger can rate the driver 1–5 stars with optional tags and a comment; the driver sees their
> aggregate rating in the dashboard. No external dependency.

## Scope

- **Data** (`TripRating` model, migration `20260914231500_t020_trip_rating`): exactly one rating per
  booking (`bookingId @unique`), written once by the owning passenger, immutable afterwards. Stars
  1–5; `tags` is a JSON array of slugs from a fixed vocabulary; `comment` optional (≤500 chars).
  Driver gains `ratingTotal` (sum of stars — integer, no float drift) + `ratingCount`, maintained
  in the SAME transaction as the rating row, so the average is always consistent.
- **Server** (`src/server/ratings.ts`): `validateRating` (stars/tags/comment) + `rateTrip`.
  `rateTrip` locks the booking row, verifies ownership + COMPLETED status, resolves the driver who
  actually COMPLETED the trip (the assignment with `reason = 'completed'` — a driver reassigned
  away before pickup is never rated), rejects a second rating (409 ALREADY_RATED; the DB unique
  constraint also guards the concurrent race), creates the rating + increments the aggregate, and
  records a `trip.rated` domain event. `driverRatingSummary` renders the average (null until the
  first rating).
- **API**: `GET/POST /api/v1/passenger/rides/[id]/rating` (passenger-session scoped, ownership
  checked). `GET /passenger/rides` now returns `ratedStars` per ride. Driver `/driver/dashboard`
  returns `driver.rating = { average, count }`.
- **UI**: My rides (`/rides`) shows a "Rate trip" action on a completed, unrated ride and the given
  stars once rated (`RateTripModal` — star picker, context tags for positive/constructive bands,
  optional comment). Driver Profile shows the aggregate `★ avg (count)` or "No ratings yet".

## Evidence

- vitest `tests/ratings.db.test.ts` (7 tests): records + aggregates, rejects double rating,
  refuses non-completed, enforces ownership (404), averages across trips, validation rules.
- Full suite 104 passed / 1 skipped (CH integration) on an isolated `_test` DB; `tsc --noEmit` clean.

## Follow-on: passenger ride receipt

- **Server** (`src/server/receipt.ts`): `passengerReceipt(bookingId, passengerId)` builds a receipt
  from the IMMUTABLE Fare — reference, completion time (the COMPLETED event), endpoints, class/pax,
  the driver + vehicle snapshot from the completing assignment, itemised fare lines, waiting, and
  payment method/status. Honest about regulated metering: `finalCents` stays null and the receipt
  shows the estimate + a clear note (the metered total is paid to the driver), never a fabricated
  total. Upfront price shows the committed final amount. Ownership-scoped; 409 `NO_RECEIPT` before
  completion.
- **API**: `GET /api/v1/passenger/rides/[id]/receipt`. **UI**: `/rides/[id]` receipt page +
  "Receipt ›" link on completed rides in My rides.
- **Email**: no email transport exists in the app (SMS/OTP is phone-only via Twilio Verify).
  Emailed receipts are deferred as a gated future enablement (needs an SMTP/provider + env) — see
  the external-blockers doc. The in-app receipt is the delivered surface.
- **Evidence**: `tests/receipt.db.test.ts` (3 tests); full suite 107 passed / 1 skipped; `tsc`
  clean; `npm run build` compiles `/rides/[id]` + the new API routes.
