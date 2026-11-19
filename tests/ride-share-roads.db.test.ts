import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// Ride-share (Task 022): the minutes shown to passengers and the driver come from Google Routes
// (traffic-aware) when it is configured. Google is mocked here: every leg takes 3× the estimate.
const calls: { departure?: string }[] = [];
vi.mock('@/server/google', async (orig) => {
  const real = await orig<typeof import('@/server/google')>();
  const { approxLegMin } = await import('@/lib/share');
  return {
    ...real,
    googleConfigured: () => true,
    googleRoute: async (a: { lat: number; lng: number }, b: { lat: number; lng: number }, departure?: string) => {
      calls.push({ departure });
      return { distanceKm: 1, etaMinutes: approxLegMin(a, b) * 3, path: [] };
    },
  };
});

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { assignBooking, changeStatus } from '@/server/assignments';
import { tryLiveShare } from '@/server/share';
import { trackingView, driverCurrentTrip } from '@/server/views';
import { createBookingSchema } from '@/lib/validation';
import { approxLegMin } from '@/lib/share';

const lca = { lat: 34.8751, lng: 33.6249, label: 'LCA' };
const nicosia = { lat: 35.1667, lng: 33.3667, label: 'Nicosia' };
const lcaNear = { lat: 34.879, lng: 33.62, label: 'LCA parking' };
const nicosia2 = { lat: 35.175, lng: 33.35, label: 'Nicosia 2' };
let n = 0;
const RUN = `${Date.now()}`;

async function booking(from: typeof lca, to: typeof lca) {
  const r = await createBooking(createBookingSchema.parse({ pickup: from, dropoff: to, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, luggageCount: 1, passengerName: 'P', phone: '+35799123456', shareOptIn: true, shareMaxExtraMin: 60 }), `roads-${RUN}-${++n}`);
  if (!r.ok) throw new Error(r.code);
  return prisma.booking.update({ where: { reference: r.body.reference }, data: { fareCents: 6000, priceType: 'REGULATED_FIXED' } });
}

beforeAll(() => { if (!dbName.endsWith('_test')) throw new Error('Refusing: not a _test DB'); });
beforeEach(async () => {
  await prisma.shareGroup.deleteMany({});
  await prisma.preAssignment.deleteMany({});
  await prisma.notificationOutbox.deleteMany({});
  await prisma.chatMessage.deleteMany({});
  await prisma.fare.deleteMany({});
  await prisma.receiptEmail.deleteMany({});
  await prisma.waitingSession.deleteMany({});
  await prisma.passengerRating.deleteMany({});
  await prisma.tripRating.deleteMany({});
  await prisma.driverOffer.deleteMany({});
  await prisma.dispatchJob.deleteMany({});
  await prisma.bookingEvent.deleteMany({});
  await prisma.assignment.deleteMany({});
  await prisma.trackingGrant.deleteMany({});
  await prisma.idempotencyReceipt.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.driver.updateMany({ data: { onDuty: false, available: false, acceptsShared: false } });
});

describe('ride-share road time', () => {
  it('uses Google traffic-aware road minutes for each passenger’s arrival and the driver’s end', async () => {
    const d = await prisma.driver.findFirstOrThrow({ where: { publicName: 'Andreas' }, include: { bindings: { where: { endedAt: null } } } });
    await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, eligibility: 'LEGACY', acceptsShared: true } });
    const now = new Date();
    await prisma.latestDriverLocation.upsert({ where: { driverId: d.id }, update: { lat: lca.lat, lng: lca.lng, accuracyM: 5, sampledAt: now, receivedAt: now, gpsSession: `r-${RUN}`, sequence: ++n }, create: { driverId: d.id, lat: lca.lat, lng: lca.lng, accuracyM: 5, sampledAt: now, receivedAt: now, gpsSession: `r-${RUN}`, sequence: ++n } });
    const host = await booking(lca, nicosia);
    await prisma.dispatchJob.deleteMany({ where: { bookingId: host.id } });
    const a = await assignBooking({ bookingId: host.id, driverId: d.id, vehicleId: d.bindings[0].vehicleId, expectedRevision: host.revision, actorId: 't', acknowledgeNoGps: true });
    if (!a.ok) throw new Error(a.code);
    await changeStatus({ bookingId: host.id, to: 'EN_ROUTE', expectedRevision: a.revision, actor: 'DRIVER', driverId: d.id });
    const guest = await booking(lcaNear, nicosia2);

    expect(await tryLiveShare(guest.id)).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => !!c.departure)).toBe(true); // traffic-aware (departure time sent)
    const g = (await prisma.shareGroup.findFirst({ where: { guestBookingId: guest.id } }))!;
    expect(g.roadRouted).toBe(true);
    // Road time = 3× the estimate, so the host's arrival is about 3× the direct estimate.
    const arr = g.arrivals as { host: number; guest: number; end: number };
    expect(arr.host).toBeGreaterThanOrEqual(approxLegMin(lca, nicosia) * 3 - 1);
    const tv = (await trackingView(host.id))!.shareProposal!;
    expect(tv.approx).toBe(false);
    expect(new Date(tv.arriveAt!).getTime()).toBe(g.createdAt.getTime() + arr.host * 60_000);
    const dv = await driverCurrentTrip(d.id);
    expect(dv.shareProposal?.endAt).toBe(new Date(g.createdAt.getTime() + arr.end * 60_000).toISOString());
    expect(dv.shareProposal?.stops.map((s) => `${s.kind}:${s.who}`)).toContain('dropoff:guest');
  });
});
