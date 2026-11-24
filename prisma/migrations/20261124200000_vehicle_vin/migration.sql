-- The same car can't be registered twice (2026-11-24): VIN on the vehicle, unique. Existing rows stay NULL.
ALTER TABLE "Vehicle" ADD COLUMN "vin" TEXT;
CREATE UNIQUE INDEX "Vehicle_vin_key" ON "Vehicle"("vin");
