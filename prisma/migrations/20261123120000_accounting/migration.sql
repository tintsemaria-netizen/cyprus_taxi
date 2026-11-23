-- Owner's bookkeeping (2026-11-23).
ALTER TABLE "StaffUser" ADD COLUMN "isOwner" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "LedgerKind" AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE "LedgerEvery" AS ENUM ('MONTH', 'YEAR');

CREATE TABLE "LedgerRecurring" (
    "id" TEXT NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "counterparty" TEXT,
    "method" TEXT,
    "note" TEXT,
    "every" "LedgerEvery" NOT NULL,
    "nextDay" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LedgerRecurring_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "day" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "counterparty" TEXT,
    "method" TEXT,
    "note" TEXT,
    "receiptKey" TEXT,
    "receiptMime" TEXT,
    "recurringId" TEXT,
    "createdById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LedgerEntry_recurringId_day_key" ON "LedgerEntry"("recurringId", "day");
CREATE INDEX "LedgerEntry_day_idx" ON "LedgerEntry"("day");
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "LedgerRecurring"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The owner is the first admin (the one created by `npm run bootstrap:admin` on the server).
-- Exactly one; can be moved with `npm run owner:set -- <login>`.
UPDATE "StaffUser" SET "isOwner" = true
WHERE "id" = (SELECT "id" FROM "StaffUser" WHERE "role" = 'ADMIN' AND "active" = true ORDER BY "createdAt" ASC LIMIT 1);
