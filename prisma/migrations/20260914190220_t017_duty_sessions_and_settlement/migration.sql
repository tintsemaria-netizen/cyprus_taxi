-- CreateTable
CREATE TABLE "DutySession" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "onlineAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offlineAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'driver',
    "activeDriverId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DutySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverSettlement" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "reportedFinalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "paymentReceived" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3),
    "note" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "correctionReason" TEXT,
    "createdByType" TEXT NOT NULL DEFAULT 'DRIVER',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DutySession_activeDriverId_key" ON "DutySession"("activeDriverId");

-- CreateIndex
CREATE INDEX "DutySession_driverId_onlineAt_idx" ON "DutySession"("driverId", "onlineAt");

-- CreateIndex
CREATE INDEX "DriverSettlement_driverId_createdAt_idx" ON "DriverSettlement"("driverId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DriverSettlement_bookingId_revision_key" ON "DriverSettlement"("bookingId", "revision");

-- AddForeignKey
ALTER TABLE "DutySession" ADD CONSTRAINT "DutySession_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverSettlement" ADD CONSTRAINT "DriverSettlement_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

