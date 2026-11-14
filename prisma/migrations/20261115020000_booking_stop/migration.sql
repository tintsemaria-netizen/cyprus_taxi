-- One optional intermediate stop per ride (2026-11-15). Price = route through the stop.
-- The driver marks arrival at the stop, may start paid waiting there (a meter at the waiting rate,
-- no grace), then continues to the destination; that waiting is added to the fare's waitingCents.
-- Additive, nullable.
ALTER TABLE "Booking" ADD COLUMN "stopLat" DOUBLE PRECISION;
ALTER TABLE "Booking" ADD COLUMN "stopLng" DOUBLE PRECISION;
ALTER TABLE "Booking" ADD COLUMN "stopLabel" TEXT;
ALTER TABLE "Booking" ADD COLUMN "stopArrivedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "stopWaitStartedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "stopDepartedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "stopWaitCents" INTEGER;
