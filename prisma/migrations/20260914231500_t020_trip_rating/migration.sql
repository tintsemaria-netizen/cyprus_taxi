-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ratingTotal" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TripRating" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "passengerId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "tags" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TripRating_bookingId_key" ON "TripRating"("bookingId");

-- CreateIndex
CREATE INDEX "TripRating_driverId_idx" ON "TripRating"("driverId");

-- AddForeignKey
ALTER TABLE "TripRating" ADD CONSTRAINT "TripRating_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripRating" ADD CONSTRAINT "TripRating_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

