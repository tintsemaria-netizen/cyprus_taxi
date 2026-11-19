-- Launch fixes §9 (2026-11-20): commission ledger in CALCULATION mode. Additive only (two new
-- tables, no change to existing data). Rollback: DROP TABLE "CommissionEntry", "CommissionRule";
-- (loses only calculation-mode entries).
-- CreateTable
CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rateBp" INTEGER NOT NULL,
    "base" TEXT NOT NULL DEFAULT 'CONFIRMED_TOTAL',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionEntry" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "bookingId" TEXT,
    "kind" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "ruleVersion" INTEGER,
    "basisCents" INTEGER,
    "sourceKey" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommissionRule_version_key" ON "CommissionRule"("version");

-- CreateIndex
CREATE INDEX "CommissionRule_effectiveFrom_idx" ON "CommissionRule"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionEntry_sourceKey_key" ON "CommissionEntry"("sourceKey");

-- CreateIndex
CREATE INDEX "CommissionEntry_driverId_createdAt_idx" ON "CommissionEntry"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "CommissionEntry_bookingId_idx" ON "CommissionEntry"("bookingId");

