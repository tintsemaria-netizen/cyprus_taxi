-- Pre-booking minimum fare by area (2026-11-22, operator).
CREATE TABLE "MinFareZone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "polygon" JSONB NOT NULL,
    "comfortCents" INTEGER NOT NULL,
    "xlCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MinFareZone_pkey" PRIMARY KEY ("id")
);

-- Starting area: the whole Nicosia district (approximate outline, the operator adjusts the corners in admin).
-- €20 for Comfort and XL, as deployed earlier today for the town; the operator sets XL separately.
INSERT INTO "MinFareZone" ("id", "name", "polygon", "comfortCents", "xlCents") VALUES (
  gen_random_uuid()::text, 'Район Никосии',
  '[[35.18,32.68],[35.14,32.84],[35.15,33.03],[35.18,33.16],[35.19,33.30],[35.18,33.40],[35.15,33.46],[35.10,33.50],[35.04,33.47],[34.99,33.42],[34.95,33.30],[34.91,33.18],[34.91,33.05],[34.94,32.95],[34.95,32.83],[34.97,32.72],[35.05,32.65],[35.14,32.62]]'::jsonb,
  2000, 2000
);
