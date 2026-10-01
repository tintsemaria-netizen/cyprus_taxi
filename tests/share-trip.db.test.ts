import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// exchangeToken sets a cookie via next/headers; stub it outside a request context.
const jar = { set: vi.fn(), get: vi.fn(() => undefined), delete: vi.fn() };
vi.mock('next/headers', () => ({ cookies: async () => jar }));

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => {
  try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; }
})();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { assignBooking, changeStatus } from '@/server/assignments';
import { createShareGrant, resolveShareToken, exchangeToken, createGrant } from '@/lib/tracking';
import { shareView, trackingView, PUBLIC_RATING_MIN_COUNT } from '@/server/views';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const input = (): CreateBookingInput =>
  ({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Test', phone: '+35799123456' } as CreateBookingInput);
let n = 0;
const RUN = `${Date.now()}`;

async function assigned() {
  const d = await prisma.driver.findFirst({ where: { publicName: 'Andreas' }, include: { bindings: { where: { endedAt: null } } } });
  await prisma.driver.update({ where: { id: d!.id }, data: { onDuty: true, available: true, active: true } });
  const now = new Date();
  await prisma.latestDriverLocation.upsert({
    where: { driverId: d!.id },
    update: { lat: marina.lat + 0.01, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `s-${RUN}`, sequence: ++n },
    create: { driverId: d!.id, lat: marina.lat + 0.01, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `s-${RUN}`, sequence: ++n },
  });
  const r = await createBooking(input(), `share-${RUN}-${++n}`);
  if (!r.ok) throw new Error('create');
  const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
  const a = await assignBooking({ bookingId: b.id, driverId: d!.id, vehicleId: d!.bindings[0].vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true });
  if (!a.ok) throw new Error('assign');
  return { bookingId: b.id, driverId: d!.id, revision: a.revision };
}

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
});
beforeEach(async () => {
  for (const t of ['tripRating', 'chatMessage', 'fare', 'waitingSession', 'driverOffer', 'dispatchJob', 'bookingEvent', 'assignment', 'trackingGrant', 'idempotencyReceipt', 'booking'] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any)[t].deleteMany({});
  }
  await prisma.driver.updateMany({ data: { ratingTotal: 0, ratingCount: 0 } });
});

describe('read-only share link', () => {
  it('a VIEW link resolves, but can never be exchanged for the FULL private session', async () => {
    const t = await assigned();
    const share = await createShareGrant(t.bookingId);
    expect(await resolveShareToken(share.token)).toBe(t.bookingId);
    expect(await exchangeToken(share.token)).toBeNull();
    // ...while the passenger's own FULL link still works, and is not accepted as a share token.
    const full = await createGrant(t.bookingId, new Date());
    expect(await exchangeToken(full.token)).toBe(t.bookingId);
    expect(await resolveShareToken(full.token)).toBeNull();
  });

  it('the shared view never contains the start code or any phone number', async () => {
    const t = await assigned();
    const full = await trackingView(t.bookingId);
    expect(full!.startCode).toMatch(/^\d{4}$/); // the private view has it…
    const v = await shareView(t.bookingId);
    const json = JSON.stringify(v);
    expect(json).not.toContain(full!.startCode!);
    expect(json).not.toMatch(/phone/i);
    expect(v!.vehicle!.plate).toBeTruthy();
    expect(v!.location).not.toBeNull(); // live while the trip is active
  });

  it('stops showing the live position once the trip ends', async () => {
    const t = await assigned();
    await changeStatus({ bookingId: t.bookingId, to: 'CANCELED', expectedRevision: t.revision, actor: 'STAFF', actorId: 's' });
    const v = await shareView(t.bookingId);
    expect(v!.status).toBe('CANCELED');
    expect(v!.location).toBeNull();
  });
});

describe('passenger tracking view', () => {
  it('gives a pickup ETA as soon as the driver is ASSIGNED', async () => {
    const t = await assigned();
    const v = await trackingView(t.bookingId);
    expect(v!.status).toBe('ASSIGNED');
    expect(v!.pickupEtaMin).not.toBeNull();
    expect(v!.pickupEta).toContain('min');
  });

  it(`shows the driver rating only from ${PUBLIC_RATING_MIN_COUNT} ratings`, async () => {
    const t = await assigned();
    await prisma.driver.update({ where: { id: t.driverId }, data: { ratingTotal: 19, ratingCount: PUBLIC_RATING_MIN_COUNT - 1 } });
    expect((await trackingView(t.bookingId))!.vehicle!.rating).toBeNull();
    await prisma.driver.update({ where: { id: t.driverId }, data: { ratingTotal: 24, ratingCount: PUBLIC_RATING_MIN_COUNT } });
    expect((await trackingView(t.bookingId))!.vehicle!.rating).toEqual({ average: 4.8, count: PUBLIC_RATING_MIN_COUNT });
  });
});
