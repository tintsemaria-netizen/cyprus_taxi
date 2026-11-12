-- Free-orders board (2026-11-12): when automatic offers to nearby drivers are exhausted, a search
-- job is "opened" — listed for any fitting on-duty driver for a short window before NO_DRIVER.
-- Additive and nullable: older images ignore it.
ALTER TABLE "DispatchJob" ADD COLUMN "openedAt" TIMESTAMP(3);
CREATE INDEX "DispatchJob_openedAt_idx" ON "DispatchJob"("openedAt");
