-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "fareBreakdown" TEXT,
ADD COLUMN     "fareCents" INTEGER,
ADD COLUMN     "priceType" TEXT,
ADD COLUMN     "quoteId" TEXT;

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "dropoffLat" DOUBLE PRECISION NOT NULL,
    "dropoffLng" DOUBLE PRECISION NOT NULL,
    "vClass" "VehicleClass" NOT NULL,
    "passengerCount" INTEGER NOT NULL,
    "luggageCount" INTEGER NOT NULL DEFAULT 0,
    "distanceMeters" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "priceType" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "totalCents" INTEGER NOT NULL,
    "rangeLowCents" INTEGER NOT NULL,
    "rangeHighCents" INTEGER NOT NULL,
    "breakdown" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Quote_createdAt_idx" ON "Quote"("createdAt");
