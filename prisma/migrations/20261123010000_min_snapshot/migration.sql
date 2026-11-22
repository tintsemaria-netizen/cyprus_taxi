-- Pre-booking minimum fixed at booking time (2026-11-23, operator): price changes in admin apply to new bookings only.
ALTER TABLE "Quote" ADD COLUMN "minCents" INTEGER, ADD COLUMN "minZone" TEXT;
ALTER TABLE "Booking" ADD COLUMN "fareMinCents" INTEGER, ADD COLUMN "fareMinZone" TEXT;
-- Existing bookings: the minimum they were actually quoted with (a «prebookMin» line in the snapshotted breakdown
-- means the price WAS the minimum; only Nicosia was switched on before this change). Others had no minimum at booking and keep none.
UPDATE "Booking" SET "fareMinCents" = "fareCents", "fareMinZone" = 'Район Никосии'
WHERE "fareBreakdown" LIKE '%"code":"prebookMin"%' AND "fareCents" IS NOT NULL;
