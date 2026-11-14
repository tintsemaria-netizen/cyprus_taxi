-- Passenger live location shared with the driver before pickup (2026-11-15). Opt-in per ride from
-- the tracking screen; kept only while the ride is ASSIGNED / EN_ROUTE / ARRIVED and cleared by
-- the dispatch worker after pickup, at the end of the ride or when older than 5 minutes.
-- Additive, nullable.
ALTER TABLE "Booking" ADD COLUMN "passengerLat" DOUBLE PRECISION;
ALTER TABLE "Booking" ADD COLUMN "passengerLng" DOUBLE PRECISION;
ALTER TABLE "Booking" ADD COLUMN "passengerLocAccuracyM" DOUBLE PRECISION;
ALTER TABLE "Booking" ADD COLUMN "passengerLocAt" TIMESTAMP(3);
