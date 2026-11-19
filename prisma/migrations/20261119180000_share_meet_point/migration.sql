-- Pre-booked ride-share pair at one airport: both meet at its one pickup point; own point kept for a break-up.
ALTER TABLE "Booking" ADD COLUMN "shareOrigPickupLat" DOUBLE PRECISION;
ALTER TABLE "Booking" ADD COLUMN "shareOrigPickupLng" DOUBLE PRECISION;
ALTER TABLE "Booking" ADD COLUMN "shareOrigPickupLabel" TEXT;
