-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "startCode" TEXT;

-- CreateTable
CREATE TABLE "WaitingSession" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "arrivedAt" TIMESTAMP(3) NOT NULL,
    "graceSeconds" INTEGER NOT NULL,
    "paidRateCentsPerMin" INTEGER NOT NULL,
    "endedAt" TIMESTAMP(3),
    "accruedCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fare" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "priceType" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "estimateCents" INTEGER,
    "waitingCents" INTEGER NOT NULL DEFAULT 0,
    "adjustmentsCents" INTEGER NOT NULL DEFAULT 0,
    "finalCents" INTEGER,
    "basis" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH_TO_DRIVER',
    "paymentStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaitingSession_bookingId_key" ON "WaitingSession"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Fare_bookingId_key" ON "Fare"("bookingId");

-- AddForeignKey
ALTER TABLE "WaitingSession" ADD CONSTRAINT "WaitingSession_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fare" ADD CONSTRAINT "Fare_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
