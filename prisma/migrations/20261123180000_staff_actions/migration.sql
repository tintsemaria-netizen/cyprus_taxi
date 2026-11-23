-- «Журнал изменений» for the owner (2026-11-23).
CREATE TABLE "StaffAction" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER,
    "seenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffAction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StaffAction_createdAt_idx" ON "StaffAction"("createdAt");
CREATE INDEX "StaffAction_seenAt_idx" ON "StaffAction"("seenAt");
