import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { assignBooking, changeStatus } from '@/server/assignments';
import { previewDropoff, confirmDropoff } from '@/server/passenger-dropoff';
import type { CreateBookingInput } from '@/lib/validation';

// Passenger changes the drop-off during the ride (operator 2026-11-27): the new price first, then
// confirm; the driver gets a push; never with a co-rider; only while a driver is on the ride.
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();
const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const mall = { lat: 34.7071, lng: 33.0226, label: 'Limassol Mall' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const RUN = `${Date.now()}`;
let n = 0;

beforeAll(() => { if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`); });

async function ride(assign = true) {
  const d = await prisma.driver.findFirstOrThrow({ where: { publicName: 'Andreas' }, include: { bindings: { where: { endedAt: null } } } });
  await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  const now = new Date();
  await prisma.latestDriverLocation.upsert({ where: { driverId: d.id }, update: { lat: marina.lat, lng: marina.lng, sampledAt: now, receivedAt: now }, create: { driverId: d.id, lat: marina.lat, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `pd-${RUN}`, sequence: ++n } });
  const r = await createBooking({ pickup: marina, dropoff: mall, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'PD', phone: '+35799123456' } as CreateBookingInput, `pdrop-${RUN}-${++n}`);
  if (!r.ok) throw new Error('create');
  let b = await prisma.booking.findUniqueOrThrow({ where: { reference: (r.body as { reference: string }).reference } });
  await prisma.dispatchJob.deleteMany({ where: { bookingId: b.id } });
  if (assign) {
    const a = await assignBooking({ bookingId: b.id, driverId: d.id, vehicleId: d.bindings[0].vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true });
    if (!a.ok) throw new Error('assign');
    b = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    if (b.status === 'ASSIGNED') await changeStatus({ bookingId: b.id, to: 'EN_ROUTE', expectedRevision: b.revision, actor: 'DRIVER', driverId: d.id, actorId: 'u' });
  }
  return { bookingId: b.id, driverId: d.id, userId: d.userId };
}

describe('passenger changes the drop-off during the ride', () => {
  it('preview changes nothing; confirm applies the new address and price and pushes the driver', async () => {
    const { bookingId, userId } = await ride();
    const before = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const p = await previewDropoff(bookingId, lca);
    if (!p.ok) throw new Error('preview ' + p.code);
    expect(p.oldFareCents).toBe(before.fareCents);
    expect(p.fareCents).toBeGreaterThan(before.fareCents ?? 0); // the airport is much further than the mall
    const still = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect([still.dropoffLabel, still.revision]).toEqual([before.dropoffLabel, before.revision]);

    const c = await confirmDropoff(bookingId, lca, p.quoteId);
    expect(c.ok).toBe(true);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect([b.dropoffLat, b.dropoffLng, b.dropoffLabel]).toEqual([lca.lat, lca.lng, lca.label]);
    expect(b.fareCents).toBe(p.fareCents);
    expect(b.priceType).toBe(p.priceType);
    expect(b.revision).toBe(before.revision + 1);
    expect(await prisma.bookingEvent.count({ where: { bookingId, type: 'DROPOFF_CHANGED', actorType: 'PASSENGER' } })).toBe(1);
    const push = await prisma.notificationOutbox.findFirst({ where: { audience: `DRIVER:${userId}`, tag: `dropoff-${bookingId}` } });
    expect(push).not.toBeNull();
  });

  it('a quote for another address does not apply', async () => {
    const { bookingId } = await ride();
    const p = await previewDropoff(bookingId, lca);
    if (!p.ok) throw new Error('preview');
    const c = await confirmDropoff(bookingId, { lat: 34.9, lng: 33.6, label: 'Elsewhere' }, p.quoteId);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.code).toBe('QUOTE_MISMATCH');
  });

  it('not with a co-rider, not before a driver is assigned, not after the ride', async () => {
    const shared = await ride();
    await prisma.booking.update({ where: { id: shared.bookingId }, data: { shareOptIn: true } });
    const s = await previewDropoff(shared.bookingId, lca);
    expect(s.ok ? null : s.code).toBe('SHARE_NO_DROPOFF_CHANGE');

    const searching = await ride(false);
    const q = await previewDropoff(searching.bookingId, lca);
    expect(q.ok ? null : q.code).toBe('BAD_STATE');

    const done = await ride();
    await prisma.booking.update({ where: { id: done.bookingId }, data: { status: 'COMPLETED' } });
    const d = await previewDropoff(done.bookingId, lca);
    expect(d.ok ? null : d.code).toBe('BAD_STATE');
  });
});
