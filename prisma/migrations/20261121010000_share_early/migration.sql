-- Ride-share pre-booking (2026-11-21): how much earlier a passenger can leave for a co-rider. Additive, nullable.
-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "shareEarlyMin" INTEGER;

