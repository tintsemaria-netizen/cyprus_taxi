-- XL driver: separate XL switch (2026-11-26).
ALTER TABLE "Driver" ADD COLUMN "takesXl" BOOLEAN NOT NULL DEFAULT true;
