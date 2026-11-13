-- Passenger pre-booking reminder (2026-11-13): set once the "your ride is in about an hour"
-- notification has been queued. Additive, nullable.
ALTER TABLE "Booking" ADD COLUMN "passengerRemindedAt" TIMESTAMP(3);
