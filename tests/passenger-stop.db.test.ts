import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { assignBooking, changeStatus } from '@/server/assignments';
import { arriveAtPickup, startTrip, completeTrip, driverStopAction } from '@/server/dispatch/lifecycle';
import { passengerSetStop } from '@/server/passenger-stop';
import type { CreateBookingInput } from '@/lib/validation';

// Passenger adds / removes the stop on a live ride (2026-11-15).
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();
const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const mall = { lat: 34.7071, lng: 33.0226, label: 'Limassol Mall' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const RUN = `${Date.now()}`;
let n = 0;

beforeAll(() => { if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`); });

async function ride() {
  const d = await prisma.driver.findFirstOrThrow({ where: { publicName: 'Andreas' }, include: { bindings: { where: { endedAt: null } } } });
  await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  const now = new Date();
  await prisma.latestDriverLocation.upsert({ where: { driverId: d.id }, update: { lat: marina.lat, lng: marina.lng, sampledAt: now, receivedAt: now }, create: { driverId: d.id, lat: marina.lat, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `ps-${RUN}`, sequence: ++n } });
  const r = await createBooking({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'PS', phone: '+35799123456' } as CreateBookingInput, `pstop-${RUN}-${++n}`);
  if (!r.ok) throw new Error('create');
  let b = await prisma.booking.findUniqueOrThrow({ where: { reference: (r.body as { reference: string }).reference } });
  await prisma.dispatchJob.deleteMany({ where: { bookingId: b.id } });
  const a = await assignBooking({ bookingId: b.id, driverId: d.id, vehicleId: d.bindings[0].vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true });
  if (!a.ok) throw new Error('assign');
  b = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
  if (b.status === 'ASSIGNED') await changeStatus({ bookingId: b.id, to: 'EN_ROUTE', expectedRevision: b.revision, actor: 'DRIVER', driverId: d.id, actorId: 'u' });
  return { bookingId: b.id, driverId: d.id };
}

describe('passenger changes the stop on a live ride', () => {
  it('a pre-booking: the stop can change before it starts, not once it has started (2026-11-23)', async () => {
    const { bookingId } = await ride();
    // Started pre-booking (EN_ROUTE with a booked time) → locked.
    await prisma.booking.update({ where: { id: bookingId }, data: { scheduledAt: new Date(Date.now() + 20 * 60_000) } });
    const r = await passengerSetStop(bookingId, mall);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('PREBOOK_STARTED');
    // Not started yet (REQUESTED) → allowed.
    await prisma.booking.update({ where: { id: bookingId }, data: { status: 'REQUESTED', scheduledAt: new Date(Date.now() + 86400_000) } });
    expect((await passengerSetStop(bookingId, mall)).ok).toBe(true);
  });

  it('adds a stop (re-quoted, driver notified), then removes it', async () => {
    const { bookingId } = await ride();
    const before = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const r = await passengerSetStop(bookingId, mall);
    expect(r.ok).toBe(true);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect([b.stopLat, b.stopLng, b.stopLabel]).toEqual([mall.lat, mall.lng, mall.label]);
    expect(b.revision).toBe(before.revision + 1);
    expect(b.fareCents).not.toBeNull();
    expect(b.quoteId).not.toBe(before.quoteId);
    expect(await prisma.bookingEvent.count({ where: { bookingId, type: 'STOP_SET', actorType: 'PASSENGER' } })).toBe(1);
    expect(await prisma.notificationOutbox.count({ where: { tag: `stop-${bookingId}` } })).toBe(1);
    const rm = await passengerSetStop(bookingId, null);
    expect(rm.ok).toBe(true);
    const c = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(c.stopLat).toBeNull();
  });

  it('is locked once the car is at the stop, and closed after the ride', async () => {
    const { bookingId, driverId } = await ride();
    expect((await passengerSetStop(bookingId, mall)).ok).toBe(true);
    let b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect((await arriveAtPickup(bookingId, driverId, b.revision)).ok).toBe(true);
    b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect((await startTrip(bookingId, driverId, b.revision, b.startCode!)).ok).toBe(true);
    expect((await driverStopAction(bookingId, driverId, 'arrived')).ok).toBe(true);
    const locked = await passengerSetStop(bookingId, { ...mall, label: 'Other' });
    expect(locked).toMatchObject({ ok: false, code: 'STOP_LOCKED' });
    await driverStopAction(bookingId, driverId, 'continue');
    b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    await completeTrip(bookingId, driverId, b.revision);
    expect(await passengerSetStop(bookingId, null)).toMatchObject({ ok: false });
  });
});
