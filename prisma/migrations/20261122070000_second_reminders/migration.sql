-- Second pre-booking reminders (operator, 2026-11-22): passenger 30 min before, driver 35 min before.
ALTER TABLE "Booking" ADD COLUMN "passengerRemind30At" TIMESTAMP(3);
ALTER TABLE "PreAssignment" ADD COLUMN "remind35At" TIMESTAMP(3);
