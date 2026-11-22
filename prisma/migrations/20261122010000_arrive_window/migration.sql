-- Pre-booking «быть на месте с … до …» (2026-11-22): arrival window. Additive, nullable.
-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "arriveBy" TIMESTAMP(3),
ADD COLUMN     "arriveFrom" TIMESTAMP(3);

