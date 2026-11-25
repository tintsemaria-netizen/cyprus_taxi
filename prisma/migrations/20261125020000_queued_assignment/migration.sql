-- Next order for a driver finishing a trip (2026-11-25): the assignment waits in his queue (one per driver)
ALTER TABLE "Assignment" ADD COLUMN "queuedDriverId" TEXT;
CREATE UNIQUE INDEX "Assignment_queuedDriverId_key" ON "Assignment"("queuedDriverId");
