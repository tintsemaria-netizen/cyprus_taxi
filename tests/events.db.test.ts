import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { recordEvent } from '@/server/events';
import { createBooking } from '@/server/bookings';
import { ingestLocation } from '@/server/location';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const input = (): CreateBookingInput => ({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Ev', phone: '+35799123456' } as CreateBookingInput);
const RUN = `${Date.now()}`;
let n = 0;

async function readyDriver(name: 'Andreas' | 'Maria') {
  const d = await prisma.driver.findFirst({ where: { publicName: name } });
  if (!d) throw new Error(`fixture ${name} missing`);
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  return d.id;
}

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
  await prisma.$queryRaw`SELECT 1`;
});

describe('domain events — atomicity + idempotency', () => {
  it('a business rollback removes the event and its delivery rows', async () => {
    const aggId = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await recordEvent(tx, { eventType: 'test.rollback', aggregateType: 'test', aggregateId: aggId, aggregateVersion: 1, payload: { x: 1 } });
        throw new Error('boom'); // roll the whole transaction back
      }),
    ).rejects.toThrow('boom');
    expect(await prisma.domainEvent.findFirst({ where: { aggregateType: 'test', aggregateId: aggId } })).toBeNull();
    expect(await prisma.analyticsDelivery.count({ where: { event: { aggregateId: aggId } } })).toBe(0);
  });

  it('a commit persists exactly one event and one PENDING delivery per sink', async () => {
    const aggId = randomUUID();
    await prisma.$transaction(async (tx) => {
      await recordEvent(tx, { eventType: 'test.commit', aggregateType: 'test', aggregateId: aggId, aggregateVersion: 1, payload: { ok: true } });
    });
    const ev = await prisma.domainEvent.findFirst({ where: { aggregateType: 'test', aggregateId: aggId } });
    expect(ev).not.toBeNull();
    const dels = await prisma.analyticsDelivery.findMany({ where: { eventId: ev!.id } });
    expect(dels.length).toBe(1);
    expect(dels[0].sink).toBe('clickhouse');
    expect(dels[0].status).toBe('PENDING');
  });

  it('is idempotent on the natural key — a duplicate emit does not poison the transaction', async () => {
    const aggId = randomUUID();
    await prisma.$transaction(async (tx) => {
      await recordEvent(tx, { eventType: 'test.dup', aggregateType: 'test', aggregateId: aggId, aggregateVersion: 1, payload: { i: 1 } });
      await recordEvent(tx, { eventType: 'test.dup', aggregateType: 'test', aggregateId: aggId, aggregateVersion: 1, payload: { i: 2 } }); // same key
    });
    expect(await prisma.domainEvent.count({ where: { aggregateType: 'test', aggregateId: aggId } })).toBe(1);
  });

  it('booking creation emits a booking.requested event with a delivery job', async () => {
    const r = await createBooking(input(), `ev-${RUN}-${++n}`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
    const ev = await prisma.domainEvent.findFirst({ where: { aggregateType: 'booking', aggregateId: b.id, eventType: 'booking.requested' } });
    expect(ev).not.toBeNull();
    // sanitized: no passenger name / phone in the payload
    const p = JSON.stringify(ev!.payload);
    expect(p).not.toContain('+35799123456');
    expect(await prisma.analyticsDelivery.count({ where: { eventId: ev!.id } })).toBe(1);
  });
});

describe('GPS history — accepted samples only', () => {
  it('an accepted sample writes durable history + a gps.sample event; an out-of-order one does not', async () => {
    const driverId = await readyDriver('Maria');
    const session = `s-${RUN}-${++n}`;
    const base = Date.now();
    const ok = await ingestLocation(driverId, { lat: 34.7, lng: 33.0, accuracyM: 8, sampledAt: new Date(base).toISOString(), gpsSession: session, sequence: 1 });
    expect(ok.ok).toBe(true);
    expect(await prisma.gpsSample.count({ where: { driverId, gpsSession: session } })).toBe(1);
    const ev = await prisma.domainEvent.findFirst({ where: { aggregateType: 'gps', aggregateId: `${driverId}:${session}`, aggregateVersion: 1 } });
    expect(ev).not.toBeNull();
    // Older sample (same session, lower sequence + older time) → rejected, no new history/event.
    const older = await ingestLocation(driverId, { lat: 34.71, lng: 33.01, accuracyM: 8, sampledAt: new Date(base - 5000).toISOString(), gpsSession: session, sequence: 0 });
    expect(older.ok).toBe(false);
    expect(await prisma.gpsSample.count({ where: { driverId, gpsSession: session } })).toBe(1);
  });
});
