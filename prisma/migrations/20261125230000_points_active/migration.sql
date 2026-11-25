-- «Точки подачи и высадки» switch of a territory (operator 2026-11-25): off keeps the points but does not move pickups / drop-offs.
ALTER TABLE "NoGoZone" ADD COLUMN "pointsActive" BOOLEAN NOT NULL DEFAULT true;
