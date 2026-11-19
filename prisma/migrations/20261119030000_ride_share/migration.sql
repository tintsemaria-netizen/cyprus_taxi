-- Task 022: ride-share «Попутчик» (airport/intercity, opt-in).
ALTER TABLE "Booking" ADD COLUMN "shareOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Booking" ADD COLUMN "shareMaxExtraMin" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "childCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Booking" ADD COLUMN "shareFullCents" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "shareFullPriceType" TEXT;
ALTER TABLE "Booking" ADD COLUMN "shareWaitMin" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "shareOrigScheduledAt" TIMESTAMP(3);
ALTER TABLE "Driver" ADD COLUMN "acceptsShared" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ShareGroup" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "hostBookingId" TEXT NOT NULL,
    "guestBookingId" TEXT NOT NULL,
    "driverId" TEXT,
    "discountPct" INTEGER NOT NULL,
    "extraMinHost" INTEGER NOT NULL,
    "extraMinGuest" INTEGER NOT NULL,
    "extraMinDriver" INTEGER NOT NULL,
    "hostFullCents" INTEGER NOT NULL,
    "guestFullCents" INTEGER NOT NULL,
    "hostCents" INTEGER NOT NULL,
    "guestCents" INTEGER NOT NULL,
    "plan" JSONB NOT NULL,
    "arrivals" JSONB,
    "startAt" TIMESTAMP(3),
    "roadRouted" BOOLEAN NOT NULL DEFAULT false,
    "hostAnswer" TEXT,
    "guestAnswer" TEXT,
    "driverAnswer" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "noShowBookingId" TEXT,
    "noShowFeeCents" INTEGER,
    "activeHostBookingId" TEXT,
    "activeGuestBookingId" TEXT,
    CONSTRAINT "ShareGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShareGroup_activeHostBookingId_key" ON "ShareGroup"("activeHostBookingId");
CREATE UNIQUE INDEX "ShareGroup_activeGuestBookingId_key" ON "ShareGroup"("activeGuestBookingId");
CREATE INDEX "ShareGroup_status_expiresAt_idx" ON "ShareGroup"("status", "expiresAt");
CREATE INDEX "ShareGroup_guestBookingId_idx" ON "ShareGroup"("guestBookingId");
CREATE INDEX "ShareGroup_hostBookingId_idx" ON "ShareGroup"("hostBookingId");
ALTER TABLE "ShareGroup" ADD CONSTRAINT "ShareGroup_hostBookingId_fkey" FOREIGN KEY ("hostBookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShareGroup" ADD CONSTRAINT "ShareGroup_guestBookingId_fkey" FOREIGN KEY ("guestBookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
