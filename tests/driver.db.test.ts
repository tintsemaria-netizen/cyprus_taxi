import { describe, it, expect, beforeAll } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { goOnline, goOffline, onlineSecondsInWindow } from '@/server/driver/duty';
import { reportSettlement } from '@/server/driver/settlement';
import { earningsSummary } from '@/server/driver/earnings';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const input = (): CreateBookingInput => ({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Drv', phone: '+35799123456' } as CreateBookingInput);
const RUN = `${Date.now()}`;
let n = 0;

async function driverAndVehicle(name: 'Andreas' | 'Maria') {
  const d = await prisma.driver.findFirst({ where: { publicName: name }, include: { bindings: { where: { endedAt: null } } } });
  if (!d || !d.bindings[0]) throw new Error(`fixture ${name} missing`);
  return { driverId: d.id, vehicleId: d.bindings[0].vehicleId };
}

// Build a COMPLETED booking attributed to `driverId` (completing assignment + regulated Fare).
async function completedTrip(driverId: string, vehicleId: string) {
  const r = await createBooking(input(), `drv-${RUN}-${++n}`);
  if (!r.ok) throw new Error('create failed');
  const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
  await prisma.assignment.create({ data: { bookingId: b.id, driverId, vehicleId, driverPublicName: 'x', driverPhone: 'x', vehiclePlate: 'x', vehicleMake: 'x', vehicleModel: 'x', vehicleColor: 'x', vehicleClass: 'COMFORT', actor: 'SYSTEM', reason: 'completed', endedAt: new Date() } });
  await prisma.booking.update({ where: { id: b.id }, data: { status: 'COMPLETED' } });
  await prisma.fare.create({ data: { bookingId: b.id, priceType: 'REGULATED_METER_ESTIMATE', currency: 'EUR', estimateCents: 1500, waitingCents: 0, finalCents: null, basis: '{}', paymentMethod: 'CASH_TO_DRIVER', paymentStatus: 'PENDING' } });
  return b.id;
}

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
  await prisma.$queryRaw`SELECT 1`;
});

describe('duty sessions', () => {
  it('opens on go-online, closes on go-offline, and measures online time', async () => {
    const { driverId } = await driverAndVehicle('Maria');
    await prisma.dutySession.updateMany({ where: { activeDriverId: driverId }, data: { offlineAt: new Date(), activeDriverId: null } }); // clean slate
    await prisma.$transaction((tx) => goOnline(tx, driverId));
    expect(await prisma.dutySession.findUnique({ where: { activeDriverId: driverId } })).not.toBeNull();
    // second go-online is idempotent (still one open session)
    await prisma.$transaction((tx) => goOnline(tx, driverId));
    expect(await prisma.dutySession.count({ where: { driverId, offlineAt: null } })).toBe(1);
    await prisma.$transaction((tx) => goOffline(tx, driverId));
    expect(await prisma.dutySession.findUnique({ where: { activeDriverId: driverId } })).toBeNull();
    const secs = await onlineSecondsInWindow(driverId, new Date(Date.now() - 3_600_000), new Date());
    expect(secs).toBeGreaterThanOrEqual(0);
  });
});

describe('driver settlement', () => {
  it('accepts a report from the completing driver and rejects another driver', async () => {
    const { driverId, vehicleId } = await driverAndVehicle('Andreas');
    const other = await driverAndVehicle('Maria');
    const bookingId = await completedTrip(driverId, vehicleId);

    const bad = await reportSettlement(other.driverId, bookingId, { reportedFinalCents: 1800 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('NOT_YOUR_TRIP');

    const good = await reportSettlement(driverId, bookingId, { reportedFinalCents: 1800, paymentReceived: true });
    expect(good.ok).toBe(true);
    if (good.ok) { expect(good.settlement.revision).toBe(1); expect(good.settlement.reportedFinalCents).toBe(1800); }

    // A correction needs a reason.
    const noReason = await reportSettlement(driverId, bookingId, { reportedFinalCents: 1900, expectedRevision: 1 });
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.code).toBe('REASON_REQUIRED');

    const corrected = await reportSettlement(driverId, bookingId, { reportedFinalCents: 1900, correctionReason: 'meter re-read', expectedRevision: 1 });
    expect(corrected.ok).toBe(true);
    if (corrected.ok) expect(corrected.settlement.revision).toBe(2);
  });

  it('earnings count a known final; a trip with no settlement is pending, not zero income', async () => {
    const { driverId, vehicleId } = await driverAndVehicle('Andreas');
    const settled = await completedTrip(driverId, vehicleId);
    const pendingTrip = await completedTrip(driverId, vehicleId);
    await reportSettlement(driverId, settled, { reportedFinalCents: 2500 });

    const from = new Date(Date.now() - 3_600_000);
    const to = new Date(Date.now() + 3_600_000);
    const sum = await earningsSummary(driverId, from, to);
    const eur = sum.byCurrency.find((c) => c.currency === 'EUR')!;
    expect(eur.recordedEarningsCents).toBeGreaterThanOrEqual(2500);
    expect(eur.pendingFinalTrips).toBeGreaterThanOrEqual(1); // the un-settled completed trip
    void pendingTrip;
  });
});
