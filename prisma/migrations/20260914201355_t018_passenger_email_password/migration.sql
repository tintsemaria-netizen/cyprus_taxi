-- AlterTable
ALTER TABLE "Passenger" ADD COLUMN     "email" TEXT,
ADD COLUMN     "passwordHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Passenger_email_key" ON "Passenger"("email");

