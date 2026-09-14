import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { changeStatus } from '@/server/assignments';
import { staffMarkArrived } from '@/server/dispatch/lifecycle';
import { runOnce } from '@/server/dispatch/worker';
import { acceptOffer, rejectOffer, expireOffer, getDriverActiveOffer } from '@/server/dispatch/offers';
import { Role } from '@prisma/client';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const input = (): CreateBookingInput => ({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Guard', phone: '+35799123456' } as CreateBookingInput);

let n = 0;
const RUN = `${Date.now()}`;

async function place(name: 'Andreas' | 'Maria', km: number) {
  const d = await prisma.driver.findFirst({ where: { publicName: name } });
  if (!d) throw new Error('fixture missing');
  await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  const now = new Date();
  await prisma.latestDriverLocation.upsert({
    where: { driverId: d.id },
    update: { lat: marina.lat + km * 0.009, lng: marina.lng, accuracyM: 10, sampledAt: now, receivedAt: now, gpsSession: `g-${RUN}`, sequence: ++n },
    create: { driverId: d.id, lat: marina.lat + km * 0.009, lng: marina.lng, accuracyM: 10, sampledAt: now, receivedAt: now, gpsSession: `g-${RUN}`, sequence: ++n },
  });
  return d.id;
}
async function newBooking() {
  const r = await createBooking(input(), `grd-${RUN}-${++n}`);
  if (!r.ok) throw new Error('create failed');
  return (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
}
async function offerTo(driverId: string) {
  await runOnce();
  const o = await getDriverActiveOffer(driverId);
  if (!o) throw new Error('no offer produced');
  return o.offerId;
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
  await prisma.booking.deleteMany({});
  for (const name of ['Andreas', 'Maria', 'Petros']) {
    const d = await prisma.driver.findFirst({ where: { publicName: name } });
    if (d) await prisma.driver.update({ where: { id: d.id }, data: { onDuty: false, available: false } });
  }
});

describe('P0 — legacy status bypass is closed', () => {
  it('generic changeStatus cannot reach ARRIVED/IN_PROGRESS/COMPLETED (any actor)', async () => {
    const b = await newBooking();
    for (const actor of ['STAFF', 'DRIVER'] as const) {
      for (const to of ['ARRIVED', 'IN_PROGRESS', 'COMPLETED'] as const) {
        const r = await changeStatus({ bookingId: b.id, to, expectedRevision: b.revision, actor, actorId: 't', driverId: 'x' });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('USE_LIFECYCLE_ACTION');
      }
    }
  });

  it('staff override requires a reason', async () => {
    const b = await newBooking();
    const r = await staffMarkArrived(b.id, b.revision, 'admin', Role.ADMIN, '');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('REASON_REQUIRED');
  });
});

describe('P0 — offer decisions serialize on the booking row', () => {
  it('accept vs reject: exactly one wins, state consistent', async () => {
    const driverId = await place('Andreas', 1);
    const b = await newBooking();
    const offerId = await offerTo(driverId);
    const [acc, rej] = await Promise.all([acceptOffer(offerId, driverId), rejectOffer(offerId, driverId)]);
    const booking = await prisma.booking.findUnique({ where: { id: b.id } });
    const offer = await prisma.driverOffer.findUnique({ where: { id: offerId } });
    const activeCount = await prisma.assignment.count({ where: { activeBookingId: b.id } });
    if (acc.ok) {
      expect(booking!.status).toBe('ASSIGNED');
      expect(offer!.status).toBe('ACCEPTED');
      expect(activeCount).toBe(1);
    } else {
      expect(booking!.status).toBe('SEARCHING');
      expect(offer!.status).toBe('REJECTED');
      expect(activeCount).toBe(0);
      expect(rej.ok).toBe(true);
    }
  });

  it('accept is blocked once the offer has expired (booking stays SEARCHING)', async () => {
    const driverId = await place('Andreas', 1);
    const b = await newBooking();
    const offerId = await offerTo(driverId);
    await prisma.driverOffer.update({ where: { id: offerId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const acc = await acceptOffer(offerId, driverId);
    expect(acc.ok).toBe(false);
    if (!acc.ok) expect(acc.code).toBe('OFFER_EXPIRED');
    expect((await prisma.booking.findUnique({ where: { id: b.id } }))!.status).toBe('SEARCHING');
  });

  it('accept vs expire: cannot both resolve the same offer', async () => {
    const driverId = await place('Andreas', 1);
    const b = await newBooking();
    const offerId = await offerTo(driverId);
    const [acc] = await Promise.all([acceptOffer(offerId, driverId), expireOffer(offerId)]);
    const offer = await prisma.driverOffer.findUnique({ where: { id: offerId } });
    const booking = await prisma.booking.findUnique({ where: { id: b.id } });
    if (acc.ok) { expect(offer!.status).toBe('ACCEPTED'); expect(booking!.status).toBe('ASSIGNED'); }
    else { expect(offer!.status).toBe('EXPIRED'); expect(booking!.status).toBe('SEARCHING'); }
  });

  it('passenger cancel vs accept: no leaked capacity', async () => {
    const driverId = await place('Andreas', 1);
    const b = await newBooking();
    const offerId = await offerTo(driverId);
    await Promise.all([
      acceptOffer(offerId, driverId),
      changeStatus({ bookingId: b.id, to: 'CANCELED', expectedRevision: b.revision, actor: 'PASSENGER', reason: 'changed mind' }),
    ]);
    const booking = await prisma.booking.findUnique({ where: { id: b.id } });
    const activeCount = await prisma.assignment.count({ where: { activeBookingId: b.id } });
    if (booking!.status === 'CANCELED') expect(activeCount).toBe(0); // no driver left reserved
    else { expect(booking!.status).toBe('ASSIGNED'); expect(activeCount).toBe(1); }
    // A driver is never left active on a canceled booking.
    expect(!(booking!.status === 'CANCELED' && activeCount > 0)).toBe(true);
  });

  it('two concurrent worker ticks, one driver, two bookings → one offer only', async () => {
    await place('Andreas', 1);
    await newBooking();
    await newBooking();
    await Promise.all([runOnce(), runOnce()]);
    expect(await prisma.driverOffer.count({ where: { status: 'OFFERED' } })).toBe(1);
  });
});
