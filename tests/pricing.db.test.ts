import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { createQuote } from '@/server/quote';
import { createBooking } from '@/server/bookings';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const qInput = { pickup: marina, dropoff: lca, vClass: 'COMFORT' as const, passengerCount: 2 };
const bInput = (): CreateBookingInput => ({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Demand', phone: '+35799123456' } as CreateBookingInput);

let n = 0;
const RUN = `${Date.now()}`;

async function placeDriver(name: 'Andreas') {
  const d = await prisma.driver.findFirst({ where: { publicName: name }, include: { bindings: { where: { endedAt: null } } } });
  if (!d) throw new Error('fixture missing');
  await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  const now = new Date();
  await prisma.latestDriverLocation.upsert({
    where: { driverId: d.id },
    update: { lat: marina.lat + 0.005, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `p-${RUN}`, sequence: ++n },
    create: { driverId: d.id, lat: marina.lat + 0.005, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `p-${RUN}`, sequence: ++n },
  });
}

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
  await prisma.$queryRaw`SELECT 1`;
});

beforeEach(async () => {
  await prisma.chatMessage.deleteMany({});
  await prisma.fare.deleteMany({});
  await prisma.waitingSession.deleteMany({});
  await prisma.driverOffer.deleteMany({});
  await prisma.dispatchJob.deleteMany({});
  await prisma.bookingEvent.deleteMany({});
  await prisma.assignment.deleteMany({});
  await prisma.trackingGrant.deleteMany({});
  await prisma.latestDriverLocation.deleteMany({});
  await prisma.idempotencyReceipt.deleteMany({});
  await prisma.quote.deleteMany({});
  await prisma.booking.deleteMany({});
  for (const name of ['Andreas', 'Maria', 'Petros']) {
    const d = await prisma.driver.findFirst({ where: { publicName: name } });
    if (d) await prisma.driver.update({ where: { id: d.id }, data: { onDuty: false, available: false } });
  }
});

describe('UPFRONT_DYNAMIC quote', () => {
  it('no supply → priceType UPFRONT_DYNAMIC but no surge (equals meter estimate)', async () => {
    const meter = await createQuote(qInput, new Date(), 'REGULATED_METER_ESTIMATE');
    const dyn = await createQuote(qInput, new Date(), 'UPFRONT_DYNAMIC');
    expect(meter.ok && dyn.ok).toBe(true);
    if (!meter.ok || !dyn.ok) return;
    expect(dyn.quote.priceType).toBe('UPFRONT_DYNAMIC');
    expect(dyn.quote.dynamic?.applied).toBe(false);
    expect(dyn.quote.totalCents).toBe(meter.quote.totalCents); // no surcharge with no supply
  });

  it('demand above supply → capped surge applied on top of the meter base', async () => {
    await placeDriver('Andreas'); // supply = 1
    for (let i = 0; i < 4; i++) {
      const r = await createBooking(bInput(), `dem-${RUN}-${++n}`);
      expect(r.ok).toBe(true); // 4 SEARCHING COMFORT requests near pickup = demand
    }
    const meter = await createQuote(qInput, new Date(), 'REGULATED_METER_ESTIMATE');
    const dyn = await createQuote(qInput, new Date(), 'UPFRONT_DYNAMIC');
    expect(meter.ok && dyn.ok).toBe(true);
    if (!meter.ok || !dyn.ok) return;
    expect(dyn.quote.dynamic?.applied).toBe(true);
    expect(dyn.quote.dynamic?.multiplier).toBe(1.5); // ratio 4:1 → capped
    expect(dyn.quote.totalCents).toBeGreaterThan(meter.quote.totalCents);
    // Upfront fare is a committed price, not a ± band.
    expect(dyn.quote.rangeLowCents).toBe(dyn.quote.totalCents);
    expect(dyn.quote.rangeHighCents).toBe(dyn.quote.totalCents);
    // The surcharge is itemised.
    expect(dyn.quote.lines.some((l) => l.code === 'dynamic')).toBe(true);
  });
});
