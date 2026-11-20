-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'FLEET_OWNER';

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "fleetId" TEXT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "fleetId" TEXT;

-- CreateTable
CREATE TABLE "Fleet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fleet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Fleet_ownerId_key" ON "Fleet"("ownerId");

-- CreateIndex
CREATE INDEX "Driver_fleetId_idx" ON "Driver"("fleetId");

-- CreateIndex
CREATE INDEX "Vehicle_fleetId_idx" ON "Vehicle"("fleetId");

-- AddForeignKey
ALTER TABLE "Fleet" ADD CONSTRAINT "Fleet_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_fleetId_fkey" FOREIGN KEY ("fleetId") REFERENCES "Fleet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

