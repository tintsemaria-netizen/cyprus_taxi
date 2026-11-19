-- Own Cyprus address base from OpenStreetMap (2026-11-19): every named place, street and house
-- address on the island with its postcode. Refreshed weekly by the worker (OsmImport = runs).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "OsmPlace" (
  "batch" INTEGER NOT NULL,
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "street" TEXT,
  "housenumber" TEXT,
  "locality" TEXT,
  "postcode" TEXT,
  "postcodeExact" BOOLEAN NOT NULL DEFAULT false,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "importance" INTEGER NOT NULL,
  "search" TEXT NOT NULL,
  "nameFold" TEXT NOT NULL,
  CONSTRAINT "OsmPlace_pkey" PRIMARY KEY ("batch", "id")
);
CREATE INDEX "OsmPlace_search_trgm" ON "OsmPlace" USING GIN ("search" gin_trgm_ops);
CREATE INDEX "OsmPlace_batch_lat_lng_idx" ON "OsmPlace" ("batch", "lat", "lng");

CREATE TABLE "OsmImport" (
  "id" SERIAL NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "rows" INTEGER,
  "withPostcode" INTEGER,
  "error" TEXT,
  CONSTRAINT "OsmImport_pkey" PRIMARY KEY ("id")
);
