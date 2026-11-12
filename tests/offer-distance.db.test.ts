import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// The new-offer card shows time AND km to the client (2026-11-12). When the pickup ETA is
// road-routed, the offer stores the DRIVING distance (not the straight line).
vi.mock('@/server/google', async (orig) => ({
  ...(await orig<typeof import('@/server/google')>()),
  googleConfigured: () => true,
  googleRoute: vi.fn(async () => ({ distanceKm: 2.4, etaMinutes: 6, polyline: null })),
}));

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { runOnce } from '@/server/dispatch/worker';
import { getDriverActiveOffer } from '@/server/dispatch/offers';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const RUN = `${Date.now()}`;

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
});
beforeEach(async () => {
  await prisma.dispatchJob.deleteMany({});
  for (const name of ['Andreas', 'Maria', 'Petros']) {
    const d = (await prisma.driver.findFirst({ where: { publicName: name } }))!;
    await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
    await prisma.driverOffer.updateMany({ where: { activeDriverId: d.id }, data: { status: 'CANCELED', activeBookingId: null, activeDriverId: null } });
    await prisma.preAssignment.updateMany({ where: { driverId: d.id, status: 'COMMITTED' }, data: { status: 'RELEASED' } });
    await prisma.driver.update({ where: { id: d.id }, data: { onDuty: false, available: false } });
  }
});

describe('offer distance to the client', () => {
  it('stores the road distance and road ETA from the router', async () => {
    const d = (await prisma.driver.findFirst({ where: { publicName: 'Maria' } }))!;
    await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
    const now = new Date();
    const loc = { lat: marina.lat + 0.009, lng: marina.lng, accuracyM: 10, sampledAt: now, receivedAt: now, gpsSession: `od-${RUN}`, sequence: 1 };
    await prisma.latestDriverLocation.upsert({ where: { driverId: d.id }, update: loc, create: { driverId: d.id, ...loc } });
    const r = await createBooking({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'K', phone: '+35799123456' } as CreateBookingInput, `od-${RUN}`);
    expect(r.ok).toBe(true);
    await runOnce();
    const offer = await getDriverActiveOffer(d.id);
    expect(offer).not.toBeNull();
    expect(offer!.pickupDistanceM).toBe(2400); // driving distance, not the ~1 km straight line
    expect(offer!.pickupEtaSec).toBe(360);
  });
});
