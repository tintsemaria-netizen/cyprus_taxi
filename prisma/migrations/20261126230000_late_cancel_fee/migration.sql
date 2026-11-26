-- Late cancel (no-show) fee, card payment only (2026-11-26)
ALTER TABLE "Booking" ADD COLUMN "lateCancelFeeCents" INTEGER;
