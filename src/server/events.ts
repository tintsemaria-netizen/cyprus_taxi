import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';

// Task 016 §4 — durable domain-event capture. `recordEvent` writes the immutable event AND
// its per-sink delivery rows in the CALLER'S transaction, so a business rollback removes the
// event and its jobs too (no fire-and-forget event). Idempotent on the natural key via
// ON CONFLICT DO NOTHING — a retried mutation never duplicates, and a duplicate never poisons
// the surrounding transaction (which a catch-after-unique-violation would).

type Db = Prisma.TransactionClient | typeof prisma;

// Analytics sinks that must receive every event. Add sinks here; each gets its own durable,
// independently-retried delivery row so one slow sink never blocks another.
export const SINKS = ['clickhouse'] as const;

// Stable, non-reversible driver identifier for analytics. Never expose raw driverId in
// ClickHouse charts/exports; a pseudonym still counts as restricted data.
export function driverPseudo(driverId: string): string {
  return createHash('sha256').update(`gps|${driverId}|${config.sessionSecret()}`).digest('hex').slice(0, 16);
}

export interface DomainEventInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion?: number; // booking.revision, offer/gps sequence, ...
  eventOrdinal?: number; // disambiguate >1 event per aggregate version
  occurredAt?: Date;
  schemaVersion?: number;
  isTest?: boolean;
  correlationId?: string | null;
  causationId?: string | null;
  payload: Record<string, unknown>;
}

export async function recordEvent(tx: Db, e: DomainEventInput): Promise<void> {
  const id = randomUUID();
  const occurredAt = e.occurredAt ?? new Date();
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "DomainEvent"
      (id, "eventType", "schemaVersion", "aggregateType", "aggregateId", "aggregateVersion", "eventOrdinal",
       "occurredAt", "recordedAt", environment, "isTest", "correlationId", "causationId", payload)
    VALUES
      (${id}, ${e.eventType}, ${e.schemaVersion ?? 1}, ${e.aggregateType}, ${e.aggregateId},
       ${e.aggregateVersion ?? 0}, ${e.eventOrdinal ?? 0}, ${occurredAt}, now(), ${config.env},
       ${e.isTest ?? false}, ${e.correlationId ?? null}, ${e.causationId ?? null},
       ${JSON.stringify(e.payload)}::jsonb)
    ON CONFLICT ("aggregateType", "aggregateId", "aggregateVersion", "eventOrdinal") DO NOTHING
    RETURNING id`;
  if (rows.length === 0) return; // duplicate — already captured, delivery rows already exist
  const eventId = rows[0].id;
  for (const sink of SINKS) {
    await tx.$executeRaw`
      INSERT INTO "AnalyticsDelivery" (id, "eventId", sink, status, "nextAttemptAt", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${eventId}, ${sink}, 'PENDING', now(), now(), now())
      ON CONFLICT ("eventId", sink) DO NOTHING`;
  }
}

// ---- Sanitized payload builders (NO names, phones, or street text ever) ----

export function bookingEventPayload(b: {
  id: string;
  vClass: string;
  passengerCount: number;
  status: string;
  priceType: string | null;
  fareCents: number | null;
  scheduledAt: Date | null;
  passengerId?: string | null;
}): Record<string, unknown> {
  return {
    bookingId: b.id,
    vClass: b.vClass,
    passengerCount: b.passengerCount,
    status: b.status,
    priceType: b.priceType ?? 'REGULATED_METER_ESTIMATE',
    fareCents: b.fareCents ?? null,
    currency: config.currency,
    scheduledAt: b.scheduledAt ? b.scheduledAt.toISOString() : null,
    hasAccount: !!b.passengerId,
  };
}
