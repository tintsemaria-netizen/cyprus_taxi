-- Fixed airport fares drawn in admin (2026-11-17).
CREATE TABLE "FixedFareZone" (
    "id" TEXT NOT NULL,
    "airport" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "polygon" JSONB NOT NULL,
    "comfortCents" INTEGER NOT NULL,
    "xlCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FixedFareZone_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FixedFareZone_airport_active_idx" ON "FixedFareZone"("airport", "active");
