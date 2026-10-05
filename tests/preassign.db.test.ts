import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { createBooking } from '@/server/bookings';
import { changeStatus } from '@/server/assignments';
import { scheduledBoard, claimScheduled, releaseScheduled, runPreassignments } from '@/server/dispatch/preassign';
import { promoteScheduled } from '@/server/dispatch/worker';
import { findBestCandidate } from '@/server/dispatch/eligibility';
import { createBookingSchema } from '@/lib/validation';

// Pre-assignment of scheduled rides (driver commits ahead; worker converts near pickup).
const MIN = 60_000;
const P = config.dispatch.preassign;
const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const RUN = `${Date.now()}`;
let n = 0;

async function driver(name: 'Andreas' | 'Maria', opts: { onDuty?: boolean } = {}) {
  const d = await prisma.driver.findFirst({ where: { publicName: name }, include: { bindings: { where: { endedAt: null } } } });
  if (!d || !d.bindings[0]) throw new Error(`fixture ${name} missing`);
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: opts.onDuty ?? false, available: opts.onDuty ?? false, active: true, eligibility: 'LEGACY' } });
  return d.id;
}

// A scheduled (REQUESTED) COMFORT ride `minutesAhead` from now.
async function scheduledRide(minutesAhead: number, flight?: string) {
  // Parsed by the same schema the HTTP route uses (normalises the flight number).
  const input = createBookingSchema.parse({ pickup: lca, dropoff: marina, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Nikos', phone: '+35799123456', ...(flight ? { flightNumber: flight } : {}) });
  const r = await createBooking(input, `pa-${RUN}-${++n}`);
  if (!r.ok) throw new Error('create');
  const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
  await prisma.dispatchJob.deleteMany({ where: { bookingId: b.id } });
  return prisma.booking.update({ where: { id: b.id }, data: { status: 'REQUESTED', scheduledAt: new Date(Date.now() + minutesAhead * MIN) } });
}

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
});
afterAll(async () => { await prisma.preAssignment.deleteMany({}); });
beforeEach(async () => {
  await prisma.preAssignment.deleteMany({});
  for (const t of ['tripRating', 'chatMessage', 'fare', 'waitingSession', 'driverOffer', 'dispatchJob', 'bookingEvent', 'assignment', 'trackingGrant', 'idempotencyReceipt', 'notificationOutbox', 'booking'] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any)[t].deleteMany({});
  }
  await prisma.driver.updateMany({ data: { onDuty: false, available: false } });
});

describe('scheduled-ride board + commitment', () => {
  it('lists fitting future rides without passenger identity, and a driver can commit', async () => {
    const d = await driver('Andreas');
    const b = await scheduledRide(240, 'a3 612');
    expect(b.flightNumber).toBe('A3612'); // normalised
    const board = await scheduledBoard(d);
    const item = board.available.find((i) => i.bookingId === b.id)!;
    expect(item).toBeTruthy();
    expect(item.airport).toBe(true);
    expect(JSON.stringify(item)).not.toContain('Nikos');
    expect(JSON.stringify(item)).not.toContain('+35799123456');
    expect(await claimScheduled(d, b.id)).toEqual({ ok: true, status: 'COMMITTED' });
    const after = await scheduledBoard(d);
    expect(after.available.find((i) => i.bookingId === b.id)).toBeUndefined();
    expect(after.mine.map((m) => m.bookingId)).toEqual([b.id]);
  });

  it('two drivers racing for the same ride: exactly one wins', async () => {
    const a = await driver('Andreas');
    const m = await driver('Maria');
    const b = await scheduledRide(300);
    const res = await Promise.all([claimScheduled(a, b.id), claimScheduled(m, b.id)]);
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    const loser = res.find((r) => !r.ok);
    expect(loser && !loser.ok && loser.code).toBe('TAKEN');
    expect(await prisma.preAssignment.count({ where: { bookingId: b.id, status: 'COMMITTED' } })).toBe(1);
  });

  it('enforces the minimum gap, the per-driver limit and the too-close window', async () => {
    const d = await driver('Andreas');
    const first = await scheduledRide(300);
    expect((await claimScheduled(d, first.id)).ok).toBe(true);
    const overlapping = await scheduledRide(300 + P.minGapMinutes - 10);
    const r1 = await claimScheduled(d, overlapping.id);
    expect(!r1.ok && r1.code).toBe('OVERLAP');
    const tooClose = await scheduledRide(P.convertMinutes + 2);
    const r2 = await claimScheduled(d, tooClose.id);
    expect(!r2.ok && r2.code).toBe('TOO_CLOSE');
    for (let i = 1; i < P.maxPerDriver; i++) expect((await claimScheduled(d, (await scheduledRide(300 + i * (P.minGapMinutes + 10))).id)).ok).toBe(true);
    const r3 = await claimScheduled(d, (await scheduledRide(300 + P.maxPerDriver * (P.minGapMinutes + 10))).id);
    expect(!r3.ok && r3.code).toBe('LIMIT');
  });

  it('a pre-booked ride is not sent to normal search while the commitment is live', async () => {
    const d = await driver('Andreas');
    const b = await scheduledRide(240);
    await claimScheduled(d, b.id);
    await prisma.booking.update({ where: { id: b.id }, data: { scheduledAt: new Date(Date.now() + 10 * MIN) } }); // inside the search lead
    await promoteScheduled(new Date());
    expect((await prisma.booking.findUnique({ where: { id: b.id } }))!.status).toBe('REQUESTED');
  });
});

describe('conversion near pickup', () => {
  async function committed(minutes: number, onDuty: boolean) {
    const d = await driver('Andreas', { onDuty });
    const b = await scheduledRide(240);
    expect((await claimScheduled(d, b.id)).ok).toBe(true);
    await prisma.booking.update({ where: { id: b.id }, data: { scheduledAt: new Date(Date.now() + minutes * MIN) } });
    await prisma.preAssignment.updateMany({ where: { bookingId: b.id }, data: { pickupAt: new Date(Date.now() + minutes * MIN) } });
    return { d, b };
  }

  it('a free, on-duty driver gets the real assignment (start code, ASSIGNED)', async () => {
    const { d, b } = await committed(P.convertMinutes - 5, true);
    const r = await runPreassignments(new Date());
    expect(r.converted).toBe(1);
    const after = (await prisma.booking.findUnique({ where: { id: b.id } }))!;
    expect(after.status).toBe('ASSIGNED');
    expect(after.startCode).toMatch(/^\d{4}$/);
    expect((await prisma.assignment.findFirst({ where: { activeBookingId: b.id } }))!.driverId).toBe(d);
    expect((await prisma.preAssignment.findFirst({ where: { bookingId: b.id } }))!.status).toBe('CONVERTED');
  });

  it('a busy driver is retried until the search lead, then the ride lapses into automatic search', async () => {
    const { d, b } = await committed(P.convertMinutes - 5, true);
    // Driver is on another active trip.
    const other = await scheduledRide(500);
    const v = await prisma.driverVehicleBinding.findFirst({ where: { driverId: d, endedAt: null } });
    await prisma.assignment.create({ data: { bookingId: other.id, driverId: d, vehicleId: v!.vehicleId, driverPublicName: 'A', driverPhone: '1', vehiclePlate: 'P', vehicleMake: 'M', vehicleModel: 'M', vehicleColor: 'C', vehicleClass: 'COMFORT', actor: 't', activeBookingId: other.id, activeDriverId: d, activeVehicleId: v!.vehicleId } });
    expect((await runPreassignments(new Date())).converted).toBe(0);
    expect((await prisma.preAssignment.findFirst({ where: { bookingId: b.id } }))!.status).toBe('COMMITTED'); // still waiting
    // Time passes to inside the scheduled-search lead → lapse, then normal promotion searches.
    await prisma.preAssignment.updateMany({ where: { bookingId: b.id }, data: { pickupAt: new Date(Date.now() + (config.dispatch.scheduleLeadMinutes - 1) * MIN) } });
    await prisma.booking.update({ where: { id: b.id }, data: { scheduledAt: new Date(Date.now() + (config.dispatch.scheduleLeadMinutes - 1) * MIN) } });
    expect((await runPreassignments(new Date())).lapsed).toBe(1);
    await promoteScheduled(new Date());
    expect((await prisma.booking.findUnique({ where: { id: b.id } }))!.status).toBe('SEARCHING');
    expect(await prisma.dispatchJob.findUnique({ where: { bookingId: b.id } })).not.toBeNull();
    expect(await prisma.notificationOutbox.count({ where: { audience: `PASSENGER:${b.id}`, title: 'Finding you a driver' } })).toBe(1);
  });

  it('an offline driver at the cutoff lapses too', async () => {
    const { b } = await committed(config.dispatch.scheduleLeadMinutes - 1, false);
    expect((await runPreassignments(new Date())).lapsed).toBe(1);
    expect((await prisma.preAssignment.findFirst({ where: { bookingId: b.id } }))!.endReason).toBe('driver offline at conversion');
  });

  it('the driver reminder is sent exactly once', async () => {
    const { d } = await committed(P.remindMinutes - 5, false);
    await runPreassignments(new Date());
    await runPreassignments(new Date());
    expect(await prisma.notificationOutbox.count({ where: { title: 'Upcoming pre-booked ride' } })).toBe(1);
    void d;
  });
});

describe('cancellation, release and protection', () => {
  it('passenger cancel ends the commitment and tells the driver', async () => {
    const d = await driver('Andreas');
    const b = await scheduledRide(240);
    await claimScheduled(d, b.id);
    const r = await changeStatus({ bookingId: b.id, to: 'CANCELED', expectedRevision: b.revision, actor: 'PASSENGER' });
    expect(r.ok).toBe(true);
    const pa = (await prisma.preAssignment.findFirst({ where: { bookingId: b.id } }))!;
    expect(pa.status).toBe('RELEASED');
    expect(pa.activeBookingId).toBeNull();
    expect(await prisma.notificationOutbox.count({ where: { title: 'Pre-booked ride update' } })).toBe(1);
  });

  it('a late driver release is flagged and the ride can be taken by someone else', async () => {
    const a = await driver('Andreas');
    const m = await driver('Maria');
    const b = await scheduledRide(240);
    await claimScheduled(a, b.id);
    await prisma.preAssignment.updateMany({ where: { bookingId: b.id }, data: { pickupAt: new Date(Date.now() + (P.lateReleaseMinutes - 10) * MIN) } });
    expect(await releaseScheduled(a, b.id)).toEqual({ ok: true, status: 'RELEASED_LATE' });
    expect((await prisma.preAssignment.findFirst({ where: { bookingId: b.id, driverId: a } }))!.endReason).toBe('driver released late');
    expect((await claimScheduled(m, b.id)).ok).toBe(true); // history row does not block a new commitment
  });

  it('a driver close to a commitment gets no new immediate offers', async () => {
    const d = await driver('Andreas', { onDuty: true });
    await prisma.driver.updateMany({ where: { id: { not: d } }, data: { onDuty: false, available: false } });
    const now = new Date();
    await prisma.latestDriverLocation.upsert({ where: { driverId: d }, update: { lat: marina.lat, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `pa-${RUN}`, sequence: ++n }, create: { driverId: d, lat: marina.lat, lng: marina.lng, accuracyM: 8, sampledAt: now, receivedAt: now, gpsSession: `pa-${RUN}`, sequence: ++n } });
    const pickupNear = { pickupLat: marina.lat, pickupLng: marina.lng, vClass: 'COMFORT' as const, passengerCount: 1 };
    expect((await findBestCandidate(pickupNear, 3, []))?.driverId).toBe(d);
    const b = await scheduledRide(240);
    await claimScheduled(d, b.id);
    await prisma.preAssignment.updateMany({ where: { bookingId: b.id }, data: { pickupAt: new Date(Date.now() + (P.protectMinutes - 5) * MIN) } });
    expect(await findBestCandidate(pickupNear, 3, [])).toBeNull();
    await prisma.latestDriverLocation.deleteMany({ where: { driverId: d } });
  });
});
