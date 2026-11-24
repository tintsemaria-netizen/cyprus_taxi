-- «Мои машины» (2026-11-24): car owner, access requests, new-car requests and their documents.
ALTER TABLE "Vehicle" ADD COLUMN "ownerDriverId" TEXT;

CREATE TABLE "CarAccess" (
  "id" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "needFleet" BOOLEAN NOT NULL DEFAULT false,
  "fleetOkAt" TIMESTAMP(3),
  "needOwner" BOOLEAN NOT NULL DEFAULT false,
  "ownerOkAt" TIMESTAMP(3),
  "needAdmin" BOOLEAN NOT NULL DEFAULT false,
  "adminOkAt" TIMESTAMP(3),
  "decidedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "CarAccess_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CarAccess_driverId_vehicleId_key" ON "CarAccess"("driverId", "vehicleId");
CREATE INDEX "CarAccess_vehicleId_status_idx" ON "CarAccess"("vehicleId", "status");
CREATE INDEX "CarAccess_status_idx" ON "CarAccess"("status");

CREATE TABLE "CarRequest" (
  "id" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "vehicle" TEXT NOT NULL,
  "vehicleId" TEXT,
  "decisionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMP(3),
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "CarRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CarRequest_driverId_status_idx" ON "CarRequest"("driverId", "status");
CREATE INDEX "CarRequest_status_idx" ON "CarRequest"("status");

CREATE TABLE "CarDocument" (
  "id" TEXT NOT NULL,
  "requestId" TEXT,
  "vehicleId" TEXT,
  "slot" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "scanStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "decision" TEXT NOT NULL DEFAULT 'PENDING',
  "decisionNote" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CarDocument_requestId_slot_idx" ON "CarDocument"("requestId", "slot");
CREATE INDEX "CarDocument_vehicleId_slot_idx" ON "CarDocument"("vehicleId", "slot");
ALTER TABLE "CarDocument" ADD CONSTRAINT "CarDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CarRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A car created from an approved application belongs to that driver (best effort for existing cars:
-- the first driver with an application bound to a non-fleet car).
UPDATE "Vehicle" v SET "ownerDriverId" = x."driverId"
FROM (
  SELECT DISTINCT ON (b."vehicleId") b."vehicleId", b."driverId"
  FROM "DriverVehicleBinding" b JOIN "Driver" d ON d.id = b."driverId"
  WHERE d."applicationId" IS NOT NULL
  ORDER BY b."vehicleId", b."startedAt" ASC
) x
WHERE x."vehicleId" = v.id AND v."fleetId" IS NULL AND v."ownerDriverId" IS NULL;
