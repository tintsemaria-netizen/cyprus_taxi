-- «Попутчик −30%» terms snapshot (TZ 2026-11-23): automatic pairing only for bookings that accepted the shown
-- terms; older bookings (no version) answer a pair offer with pickup-time options.
ALTER TABLE "Booking"
  ADD COLUMN "shareTermsVersion" TEXT,
  ADD COLUMN "shareTermsAt" TIMESTAMP(3),
  ADD COLUMN "sharePickupFrom" TIMESTAMP(3),
  ADD COLUMN "sharePickupTo" TIMESTAMP(3),
  ADD COLUMN "shareBookedPickupAt" TIMESTAMP(3),
  ADD COLUMN "shareBookedCents" INTEGER;
ALTER TABLE "ShareGroup" ADD COLUMN "variants" JSONB, ADD COLUMN "chosenVariant" INTEGER;
