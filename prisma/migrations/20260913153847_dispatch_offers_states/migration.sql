-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookingStatus" ADD VALUE 'SEARCHING';
ALTER TYPE "BookingStatus" ADD VALUE 'NO_DRIVER';

-- CreateTable
CREATE TABLE "DispatchJob" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "triedDriverIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "radiusStage" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverOffer" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "pickupEtaSec" INTEGER,
    "pickupDistanceM" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OFFERED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "activeBookingId" TEXT,
    "activeDriverId" TEXT,

    CONSTRAINT "DriverOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DispatchJob_bookingId_key" ON "DispatchJob"("bookingId");

-- CreateIndex
CREATE INDEX "DispatchJob_leaseUntil_idx" ON "DispatchJob"("leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "DriverOffer_activeBookingId_key" ON "DriverOffer"("activeBookingId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverOffer_activeDriverId_key" ON "DriverOffer"("activeDriverId");

-- CreateIndex
CREATE INDEX "DriverOffer_bookingId_idx" ON "DriverOffer"("bookingId");

-- CreateIndex
CREATE INDEX "DriverOffer_driverId_idx" ON "DriverOffer"("driverId");

-- AddForeignKey
ALTER TABLE "DispatchJob" ADD CONSTRAINT "DispatchJob_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverOffer" ADD CONSTRAINT "DriverOffer_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverOffer" ADD CONSTRAINT "DriverOffer_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
