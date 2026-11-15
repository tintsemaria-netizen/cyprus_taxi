-- Driver rates the passenger 1–5 stars after a completed ride (2026-11-15). One per booking.
CREATE TABLE "PassengerRating" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "passengerId" TEXT,
  "stars" INTEGER NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PassengerRating_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PassengerRating_bookingId_key" ON "PassengerRating"("bookingId");
CREATE INDEX "PassengerRating_passengerId_idx" ON "PassengerRating"("passengerId");
ALTER TABLE "PassengerRating" ADD CONSTRAINT "PassengerRating_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
