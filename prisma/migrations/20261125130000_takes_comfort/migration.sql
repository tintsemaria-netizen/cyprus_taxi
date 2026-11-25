-- An XL car takes Comfort orders too; the driver can switch that off (2026-11-25).
ALTER TABLE "Driver" ADD COLUMN "takesComfort" BOOLEAN NOT NULL DEFAULT true;
