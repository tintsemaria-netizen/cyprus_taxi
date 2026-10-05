-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "flightNumber" TEXT;

-- CreateTable
CREATE TABLE "PreAssignment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "pickupAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMMITTED',
    "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remindedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "activeBookingId" TEXT,

    CONSTRAINT "PreAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PreAssignment_activeBookingId_key" ON "PreAssignment"("activeBookingId");

-- CreateIndex
CREATE INDEX "PreAssignment_bookingId_idx" ON "PreAssignment"("bookingId");

-- CreateIndex
CREATE INDEX "PreAssignment_driverId_status_pickupAt_idx" ON "PreAssignment"("driverId", "status", "pickupAt");

-- CreateIndex
CREATE INDEX "PreAssignment_status_pickupAt_idx" ON "PreAssignment"("status", "pickupAt");

-- AddForeignKey
ALTER TABLE "PreAssignment" ADD CONSTRAINT "PreAssignment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreAssignment" ADD CONSTRAINT "PreAssignment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

