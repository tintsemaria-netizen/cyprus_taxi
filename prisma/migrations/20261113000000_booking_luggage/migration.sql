-- Pre-booking details (2026-11-13): number of bags, shown to the driver. Additive with a default.
ALTER TABLE "Booking" ADD COLUMN "luggageCount" INTEGER NOT NULL DEFAULT 0;
