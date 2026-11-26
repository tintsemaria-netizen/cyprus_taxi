-- E-mailed receipt settings (2026-11-26): per-ride / weekly / monthly / off.
ALTER TABLE "Passenger" ADD COLUMN "receiptMode" TEXT NOT NULL DEFAULT 'EACH';
ALTER TABLE "Passenger" ADD COLUMN "receiptModeSince" TIMESTAMP(3);

CREATE TABLE "ReceiptDigest" (
    "id" TEXT NOT NULL,
    "passengerId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "toEmail" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "bookingIds" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReceiptDigest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReceiptDigest_passengerId_period_periodStart_key" ON "ReceiptDigest"("passengerId", "period", "periodStart");
CREATE INDEX "ReceiptDigest_status_nextAttemptAt_idx" ON "ReceiptDigest"("status", "nextAttemptAt");
