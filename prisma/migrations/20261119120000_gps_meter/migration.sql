-- GPS taximeter reading at completion (comparison only, not charged).
ALTER TABLE "Fare" ADD COLUMN "gpsMeterCents" INTEGER;
ALTER TABLE "Fare" ADD COLUMN "gpsMeterKm" DOUBLE PRECISION;
ALTER TABLE "Fare" ADD COLUMN "gpsMeterSlowSec" INTEGER;
ALTER TABLE "Fare" ADD COLUMN "gpsMeterGapSec" INTEGER;
