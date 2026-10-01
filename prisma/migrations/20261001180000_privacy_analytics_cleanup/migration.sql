-- Privacy cleanup (2026-10-01 audit, Stage 1.11). Analytics events written before this release
-- carried a raw driverId (gps.sample aggregateId, duty correlationId) and exact GPS coordinates.
-- New events are pseudonymous + coarsened; remove/clean the legacy ones. GPS samples are not used
-- by any analytics query, and the exact track remains only in "GpsSample" (short retention).
DELETE FROM "AnalyticsDelivery" WHERE "eventId" IN (SELECT id FROM "DomainEvent" WHERE "eventType" = 'gps.sample');
DELETE FROM "DomainEvent" WHERE "eventType" = 'gps.sample';
UPDATE "DomainEvent" SET "correlationId" = NULL WHERE "eventType" IN ('driver.online', 'driver.offline');
