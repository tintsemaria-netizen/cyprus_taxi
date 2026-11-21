-- AlterTable
ALTER TABLE "Passenger" ADD COLUMN     "appleSub" TEXT,
ADD COLUMN     "googleSub" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Passenger_googleSub_key" ON "Passenger"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "Passenger_appleSub_key" ON "Passenger"("appleSub");

