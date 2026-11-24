-- Drop-off points of a pickup territory (2026-11-24): [{lat,lng,name}], separate from the pickup points
ALTER TABLE "NoGoZone" ADD COLUMN "dropPoints" JSONB;
