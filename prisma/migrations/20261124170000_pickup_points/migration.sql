-- Pickup point territories (2026-11-24): kind + one or more pickup points
ALTER TABLE "NoGoZone" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'NOGO';
ALTER TABLE "NoGoZone" ADD COLUMN "points" JSONB;
