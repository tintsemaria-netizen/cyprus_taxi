import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { assignBooking, changeStatus } from '@/server/assignments';
import { arriveAtPickup, startTrip, completeTrip, driverStopAction, stopWaitCentsFor } from '@/server/dispatch/lifecycle';
import { quoteRequestHash } from '@/server/quote';
import type { CreateBookingInput } from '@/lib/validation';

// One intermediate stop per ride (2026-11-15).
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const stop = { lat: 34.7071, lng: 33.0226, label: 'Limassol Mall' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const RUN = `${Date.now()}`;
let n = 0;

async function driver() {
  const d = await prisma.driver.findFirst({ where: { publicName: 'Andreas' }, include: { bindings: { where: { endedAt: null } } } });
  if (!d || !d.bindings[0]) throw new Error('fixture Andreas missing');
  await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  const now = new Date();
  await prisma.latestDriverLocation.upsert({
    where: { driverId: d.id },
    update: { lat: marina.lat + 0.0001, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `s-${RUN}`, sequence: ++n },
    create: { driverId: d.id, lat: marina.lat + 0.0001, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `s-${RUN}`, sequence: ++n },
  });
  return { driverId: d.id, vehicleId: d.bindings[0].vehicleId };
}

beforeAll(() => { if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`); });

describe('booking with a stop', () => {
  it('quote hash changes with a stop and is unchanged without one', () => {
    const base = { pickup: marina, dropoff: lca, vClass: 'COMFORT' as const, passengerCount: 1 };
    expect(quoteRequestHash({ ...base, stop: null })).toBe(quoteRequestHash(base));
    expect(quoteRequestHash({ ...base, stop })).not.toBe(quoteRequestHash(base));
  });

  it('stores the stop; arrived → paid wait → continue; stop waiting is added to the fare', async () => {
    const { driverId, vehicleId } = await driver();
    const r = await createBooking({ pickup: marina, stop, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'Stop', phone: '+35799123456' } as CreateBookingInput, `stop-${RUN}-${++n}`);
    if (!r.ok) throw new Error('create ' + JSON.stringify(r));
    const b = (await prisma.booking.findUnique({ where: { reference: (r.body as { reference: string }).reference } }))!;
    expect(b).toMatchObject({ stopLat: stop.lat, stopLng: stop.lng, stopLabel: stop.label });

    const a = await assignBooking({ bookingId: b.id, driverId, vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true });
    if (!a.ok) throw new Error('assign ' + a.code);
    let rev = a.revision;
    const er = await changeStatus({ bookingId: b.id, to: 'EN_ROUTE', expectedRevision: rev, actor: 'DRIVER', driverId, actorId: 'u' });
    if (er.ok) rev = er.revision; // accept may already be EN_ROUTE
    else rev = (await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).revision;
    const ar = await arriveAtPickup(b.id, driverId, rev); if (!ar.ok) throw new Error('arrive ' + JSON.stringify(ar)); rev = ar.revision;

    // stop actions only during the trip
    expect((await driverStopAction(b.id, driverId, 'arrived')).ok).toBe(false);
    const code = (await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).startCode!;
    const st = await startTrip(b.id, driverId, rev, code); if (!st.ok) throw new Error('start'); rev = st.revision;

    expect((await driverStopAction(b.id, driverId, 'wait')).ok).toBe(false);      // not at the stop yet
    expect((await driverStopAction(b.id, driverId, 'continue')).ok).toBe(false);  // must arrive first
    expect((await driverStopAction(b.id, driverId, 'arrived')).ok).toBe(true);
    expect((await driverStopAction(b.id, driverId, 'wait')).ok).toBe(true);
    // pretend the meter ran 4 minutes
    await prisma.booking.update({ where: { id: b.id }, data: { stopWaitStartedAt: new Date(Date.now() - 4 * 60_000) } });
    const cont = await driverStopAction(b.id, driverId, 'continue'); expect(cont.ok).toBe(true);
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.stopDepartedAt).not.toBeNull();
    expect(after.stopWaitCents).toBe(stopWaitCentsFor(after.stopWaitStartedAt!, after.stopDepartedAt!));

    const co = await completeTrip(b.id, driverId, after.revision); expect(co.ok).toBe(true);
    const fare = await prisma.fare.findUniqueOrThrow({ where: { bookingId: b.id } });
    const pickupWait = (await prisma.waitingSession.findUnique({ where: { bookingId: b.id } }))?.accruedCents ?? 0;
    expect(fare.waitingCents).toBe(pickupWait + (after.stopWaitCents ?? 0));
  });

  it('stop waiting is priced by the taximeter waiting tariff, no grace', () => {
    const t0 = new Date('2026-01-02T10:00:00Z'); // 12:00 Nicosia (day)
    expect(stopWaitCentsFor(t0, new Date('2026-01-02T10:03:00Z'))).toBe(85); // 3 min × €17/h
    expect(stopWaitCentsFor(t0, t0)).toBe(0);
  });
});
