# Existing-driver migration & enforcement (Task 015 §7)

Date: 2026-09-14.

## Decision (owner-authorized 2026-09-14)

Introduce a `Driver.eligibility` gate (`LEGACY | APPROVED | PENDING | SUSPENDED |
DOCUMENTS_EXPIRED`). Only `LEGACY` or `APPROVED` drivers may work. Per the owner's decision,
**all drivers that existed before this migration are grandfathered to `LEGACY`** — a
documented, temporary status so the current fleet keeps operating — and will be moved through
proper review later. **New self-registrations are always gated** (a driver row is only created,
as `APPROVED`, by admin approval of a KYC application).

## Migration mechanics (safe, non-destructive)

- Migration `20260914110013_driver_applications_kyc` adds the column (default `PENDING`) and
  then runs `UPDATE "Driver" SET "eligibility" = 'LEGACY';` **within the same migration**, so
  the gate can never lock out pre-existing drivers on deploy. No data reset; active rides,
  assignments, bindings, staff accounts and identity are preserved.
- Seed sets demo drivers to `LEGACY`.

## Affected existing operational drivers (beta, by public name — non-sensitive)

At migration time the beta had 5 driver records: **Ilias, Alex, Petros** (bound to a vehicle)
and **Andreas, Maria** (no active binding). All set to `LEGACY`. Vehicle bindings and
uniqueness preserved. (Andreas/Maria remain unbound and therefore un-dispatchable regardless,
as before.)

## Enforcement points (all gated on `LEGACY|APPROVED`)

Going on duty/available; public fleet exposure; dispatch candidate selection; market
supply snapshot; offer acceptance (rechecked in-transaction); manual admin assignment &
reassignment. See `src/lib/eligibility-policy.ts`.

## Follow-up (not done here; needs a later operator pass)

- Move LEGACY drivers through document capture/review to `APPROVED` (a review queue for
  legacy drivers), then retire the `LEGACY` exemption.
- Expiry-driven `DOCUMENTS_EXPIRED` transitions + renewal review (schema supports it; the
  scheduled expiry reminders/blocks in §5 are not yet implemented).
