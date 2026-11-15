import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { assignBooking, changeStatus } from '@/server/assignments';
import { arriveAtPickup, startTrip, completeTrip } from '@/server/dispatch/lifecycle';
import { farePreview, ratePassenger, passengerRatingSummary } from '@/server/trip-close';
import type { CreateBookingInput } from '@/lib/validation';

// Driver close-out (2026-11-15): fare preview before final completion; driver rates the passenger.
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();
beforeAll(() => { if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`); });

const RUN = `${Date.now()}`;
it('fare preview = estimate + waiting; rating once, only by the completing driver, after completion', async () => {
  const pax = await prisma.passenger.create({ data: { name: 'Close', email: `close${RUN}@example.com` } });
  const d = await prisma.driver.findFirstOrThrow({ where: { publicName: 'Andreas' }, include: { bindings: { where: { endedAt: null } } } });
  await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { activeDriverId: null, activeBookingId: null, activeVehicleId: null, endedAt: new Date() } });
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  const now = new Date();
  await prisma.latestDriverLocation.upsert({ where: { driverId: d.id }, update: { lat: 34.6707, lng: 33.0413, sampledAt: now, receivedAt: now }, create: { driverId: d.id, lat: 34.6707, lng: 33.0413, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `s-${RUN}`, sequence: 1 } });
  const r = await createBooking({ pickup: { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' }, stop: { lat: 34.7071, lng: 33.0226, label: 'Limassol Mall' }, dropoff: { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' }, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'Close', phone: '+35799123456' } as CreateBookingInput, `close-${RUN}`, undefined, pax.id);
  if (!r.ok) throw new Error('create');
  let b = await prisma.booking.findUniqueOrThrow({ where: { reference: (r.body as { reference: string }).reference } });
  const a = await assignBooking({ bookingId: b.id, driverId: d.id, vehicleId: d.bindings[0].vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true });
  if (!a.ok) throw new Error('assign');
  b = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
  if (b.status === 'ASSIGNED') await changeStatus({ bookingId: b.id, to: 'EN_ROUTE', expectedRevision: b.revision, actor: 'DRIVER', driverId: d.id, actorId: 'u' });
  b = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
  expect((await arriveAtPickup(b.id, d.id, b.revision)).ok).toBe(true);
  b = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
  const st = await startTrip(b.id, d.id, b.revision, b.startCode!); expect(st.ok).toBe(true);
  await prisma.booking.update({ where: { id: b.id }, data: { stopArrivedAt: new Date(), stopWaitStartedAt: new Date(Date.now() - 6 * 60_000), stopDepartedAt: new Date() } });

  expect(await ratePassenger(b.id, d.id, 5)).toMatchObject({ ok: false, code: 'NOT_COMPLETED' });
  const p = await farePreview(b.id, d.id);
  expect(p).not.toBeNull();
  expect(p!.stopWaitCents).toBeGreaterThan(0);
  expect(p!.totalCents).toBe((p!.estimateCents ?? 0) + p!.pickupWaitCents + p!.stopWaitCents);
  expect(await farePreview(b.id, '00000000-0000-0000-0000-000000000000')).toBeNull(); // not this driver's ride

  b = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
  expect((await completeTrip(b.id, d.id, b.revision)).ok).toBe(true);
  const fare = await prisma.fare.findUniqueOrThrow({ where: { bookingId: b.id } });
  expect(fare.waitingCents).toBe(p!.pickupWaitCents + p!.stopWaitCents); // preview matches what is recorded

  expect(await ratePassenger(b.id, d.id, 0)).toMatchObject({ ok: false, code: 'VALIDATION' });
  expect(await ratePassenger(b.id, '00000000-0000-0000-0000-000000000000', 4)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  expect(await ratePassenger(b.id, d.id, 4, 'Пунктуальный')).toEqual({ ok: true });
  expect(await ratePassenger(b.id, d.id, 5)).toMatchObject({ ok: false, code: 'ALREADY_RATED' });
  expect((await passengerRatingSummary([pax.id])).get(pax.id)).toEqual({ average: 4, count: 1 });
});

describe('noop', () => { it('placeholder', () => expect(true).toBe(true)); });
