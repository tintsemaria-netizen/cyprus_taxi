-- «Минимальный заказ отсюда» (operator 2026-11-25): per pickup territory, Comfort / XL. Empty = no minimum.
ALTER TABLE "NoGoZone" ADD COLUMN "minComfortCents" INTEGER;
ALTER TABLE "NoGoZone" ADD COLUMN "minXlCents" INTEGER;
