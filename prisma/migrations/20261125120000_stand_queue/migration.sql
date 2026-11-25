-- «Стоянка с очередью» (2026-11-25): the queue of drivers on a stand (NoGoZone kind STAND).
CREATE TABLE "StandQueue" (
    "driverId" TEXT NOT NULL,
    "standId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StandQueue_pkey" PRIMARY KEY ("driverId")
);
CREATE INDEX "StandQueue_standId_enteredAt_idx" ON "StandQueue"("standId", "enteredAt");
