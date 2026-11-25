-- «Минимальный заказ отсюда» (operator 2026-11-25): per pickup territory, Comfort / XL. Empty = no minimum.
ALTER TABLE "NoGoZone" ADD COLUMN "minComfortCents" INTEGER;
ALTER TABLE "NoGoZone" ADD COLUMN "minXlCents" INTEGER;
-- The switch next to it, with a confirmation in admin: off keeps the amounts but they do not apply.
ALTER TABLE "NoGoZone" ADD COLUMN "minActive" BOOLEAN NOT NULL DEFAULT true;
