-- Two rounds of driver offers before the free-orders board (operator 2026-11-27).
ALTER TABLE "DispatchJob" ADD COLUMN "offerRound" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "DispatchJob" ADD COLUMN "blockedDriverIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
