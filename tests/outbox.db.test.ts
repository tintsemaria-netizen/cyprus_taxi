import { describe, it, expect, beforeAll } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { enqueue, drainOutbox } from '@/server/outbox';
import { createBooking } from '@/server/bookings';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const input = (): CreateBookingInput => ({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Ob', phone: '+35799123456' } as CreateBookingInput);
const RUN = `${Date.now()}`;
let n = 0;

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
  await prisma.$queryRaw`SELECT 1`;
});

describe('notification outbox — claim + precise outcomes', () => {
  it('drains a passenger note to NO_SUBSCRIBERS when nobody is subscribed (not "delivered")', async () => {
    const r = await createBooking(input(), `ob-${RUN}-${++n}`);
    if (!r.ok) throw new Error('create failed');
    const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
    const key = `note-${RUN}-${n}`;
    await enqueue(prisma, { audience: `PASSENGER:${b.id}`, title: 't', body: 'b', url: '/track', dedupeKey: key });
    const before = (await prisma.notificationOutbox.findUnique({ where: { dedupeKey: key } }))!;
    expect(before.status).toBe('PENDING');
    await drainOutbox(new Date());
    const after = (await prisma.notificationOutbox.findUnique({ where: { id: before.id } }))!;
    expect(after.status).toBe('NO_SUBSCRIBERS');
    expect(after.deliveredAt).not.toBeNull();
    expect(after.leaseToken).toBeNull(); // lease released
  });

  it('dedupeKey prevents a duplicate enqueue', async () => {
    const key = `dup-${RUN}-${++n}`;
    await enqueue(prisma, { audience: `PASSENGER:x`, title: 't', body: 'b', url: '/track', dedupeKey: key });
    await enqueue(prisma, { audience: `PASSENGER:x`, title: 't2', body: 'b2', url: '/track', dedupeKey: key });
    expect(await prisma.notificationOutbox.count({ where: { dedupeKey: key } })).toBe(1);
  });

  it('a stale offer notification is marked SUPERSEDED, never delivered', async () => {
    const d = await prisma.driver.findFirst({ where: { publicName: 'Andreas' }, include: { bindings: { where: { endedAt: null } } } });
    if (!d || !d.bindings[0]) throw new Error('fixture Andreas missing');
    const r = await createBooking(input(), `ob-${RUN}-${++n}`);
    if (!r.ok) throw new Error('create failed');
    const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
    // An offer that is already expired (still status OFFERED but past expiresAt) → not live.
    const offer = await prisma.driverOffer.create({
      data: { bookingId: b.id, driverId: d.id, vehicleId: d.bindings[0].vehicleId, status: 'OFFERED', expiresAt: new Date(Date.now() - 1000) },
    });
    const key = `offer-${RUN}-${n}`;
    await enqueue(prisma, { audience: `DRIVER:${d.userId}`, title: 'New ride offer', body: 'x', url: '/driver', tag: 'offer', offerId: offer.id, dedupeKey: key });
    await drainOutbox(new Date());
    const after = (await prisma.notificationOutbox.findUnique({ where: { dedupeKey: key } }))!;
    expect(after.status).toBe('SUPERSEDED');
  });

  it('a crashed lease (PROCESSING past leaseUntil) is reclaimed on the next drain', async () => {
    const key = `lease-${RUN}-${++n}`;
    await enqueue(prisma, { audience: `PASSENGER:y`, title: 't', body: 'b', url: '/track', dedupeKey: key });
    const row = (await prisma.notificationOutbox.findUnique({ where: { dedupeKey: key } }))!;
    // Simulate a worker that claimed the row then died: PROCESSING with an expired lease.
    await prisma.notificationOutbox.update({ where: { id: row.id }, data: { status: 'PROCESSING', leaseOwner: 'dead', leaseToken: 'zzz', leaseUntil: new Date(Date.now() - 60_000) } });
    await drainOutbox(new Date());
    const after = (await prisma.notificationOutbox.findUnique({ where: { id: row.id } }))!;
    // Reclaimed → retried → terminal (no subscribers). It must NOT be stuck in PROCESSING.
    expect(['NO_SUBSCRIBERS', 'RETRY', 'SENT_TO_PROVIDER']).toContain(after.status);
    expect(after.leaseToken).toBeNull();
  });
});
