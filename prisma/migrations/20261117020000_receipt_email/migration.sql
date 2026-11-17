-- E-mailed trip receipts (2026-11-17).
ALTER TABLE "Passenger" ADD COLUMN "locale" TEXT;

CREATE TABLE "ReceiptEmail" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "passengerId" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReceiptEmail_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReceiptEmail_bookingId_key" ON "ReceiptEmail"("bookingId");
CREATE INDEX "ReceiptEmail_status_nextAttemptAt_idx" ON "ReceiptEmail"("status", "nextAttemptAt");
CREATE INDEX "ReceiptEmail_passengerId_idx" ON "ReceiptEmail"("passengerId");
