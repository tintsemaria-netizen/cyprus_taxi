-- AlterTable
ALTER TABLE "NotificationOutbox" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "leaseOwner" TEXT,
ADD COLUMN     "leaseToken" TEXT,
ADD COLUMN     "leaseUntil" TIMESTAMP(3),
ADD COLUMN     "offerId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "aggregateVersion" INTEGER NOT NULL DEFAULT 0,
    "eventOrdinal" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "environment" TEXT NOT NULL DEFAULT 'beta',
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "correlationId" TEXT,
    "causationId" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sink" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "role" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "beatAt" TIMESTAMP(3) NOT NULL,
    "detail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("role")
);

-- CreateTable
CREATE TABLE "GpsSample" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "gpsSession" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracyM" DOUBLE PRECISION NOT NULL,
    "heading" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "sampledAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GpsSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DomainEvent_recordedAt_idx" ON "DomainEvent"("recordedAt");

-- CreateIndex
CREATE INDEX "DomainEvent_eventType_recordedAt_idx" ON "DomainEvent"("eventType", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DomainEvent_aggregateType_aggregateId_aggregateVersion_even_key" ON "DomainEvent"("aggregateType", "aggregateId", "aggregateVersion", "eventOrdinal");

-- CreateIndex
CREATE INDEX "AnalyticsDelivery_sink_status_nextAttemptAt_idx" ON "AnalyticsDelivery"("sink", "status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDelivery_eventId_sink_key" ON "AnalyticsDelivery"("eventId", "sink");

-- CreateIndex
CREATE INDEX "GpsSample_driverId_sampledAt_idx" ON "GpsSample"("driverId", "sampledAt");

-- CreateIndex
CREATE INDEX "GpsSample_receivedAt_idx" ON "GpsSample"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GpsSample_driverId_gpsSession_sequence_key" ON "GpsSample"("driverId", "gpsSession", "sequence");

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_nextAttemptAt_idx" ON "NotificationOutbox"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "AnalyticsDelivery" ADD CONSTRAINT "AnalyticsDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DomainEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

