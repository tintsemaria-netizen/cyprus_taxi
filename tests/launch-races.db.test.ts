import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// Launch fixes §5 (2026-11-19): assignment races on the real _test Postgres. Complements
// lifecycle-guards (accept vs reject / expiry / cancel) and free-orders (two claims).
const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { createBooking } from '@/server/bookings';
import { assignBooking, changeStatus, unassignBooking } from '@/server/assignments';
import { arriveAtPickup, startTrip, completeTrip } from '@/server/dispatch/lifecycle';
import { runOnce } from '@/server/dispatch/worker';
import { acceptOffer, getDriverActiveOffer } from '@/server/dispatch/offers';
import { reportSettlement } from '@/server/driver/settlement';
import { ingestLocation } from '@/server/location';
import { config } from '@/lib/config';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const input = (): CreateBookingInput => ({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'Race', phone: '+35799123456' } as CreateBookingInput);
let n = 0;
const RUN = `${Date.now()}`;
const GPS_LOSS_MS = config.dispatch.gpsLossRematchSeconds * 1000;

async function driverAt(name: 'Andreas' | 'Maria', km: number, ageMs = 0) {
  const d = await prisma.driver.findFirst({ where: { publicName: name }, include: { bindings: { where: { endedAt: null } }, user: true } });
  if (!d || !d.bindings[0]) throw new Error(`fixture ${name} missing`);
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  const at = new Date(Date.now() - ageMs);
  const pos = { lat: marina.lat + km * 0.009, lng: marina.lng, accuracyM: 8, sampledAt: at, receivedAt: at, gpsSession: `lr-${RUN}`, sequence: ++n };
  await prisma.latestDriverLocation.upsert({ where: { driverId: d.id }, update: pos, create: { driverId: d.id, ...pos } });
  return { driverId: d.id, vehicleId: d.bindings[0].vehicleId, userId: d.userId };
}
async function newBooking() {
  const r = await createBooking(input(), `lr-${RUN}-${++n}`);
  if (!r.ok) throw new Error('create failed');
  return (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
}
async function enRoute(drv: { driverId: string; vehicleId: string }) {
  const b = await newBooking();
  await prisma.dispatchJob.deleteMany({ where: { bookingId: b.id } });
  const a = await assignBooking({ bookingId: b.id, driverId: drv.driverId, vehicleId: drv.vehicleId, expectedRevision: b.revision, actorId: 't', acknowledgeNoGps: true });
  if (!a.ok) throw new Error('assign failed');
  const er = await changeStatus({ bookingId: b.id, to: 'EN_ROUTE', expectedRevision: a.revision, actor: 'DRIVER', driverId: drv.driverId, actorId: 'u' });
  if (!er.ok) throw new Error('en route failed');
  return { id: b.id, rev: er.revision };
}
async function inProgress(drv: { driverId: string; vehicleId: string }) {
  const b = await enRoute(drv);
  const ar = await arriveAtPickup(b.id, drv.driverId, b.rev); if (!ar.ok) throw new Error('arrive');
  const code = (await prisma.booking.findUnique({ where: { id: b.id } }))!.startCode!;
  const st = await startTrip(b.id, drv.driverId, ar.revision, code); if (!st.ok) throw new Error('start');
  return { id: b.id, rev: st.revision };
}
const activeOf = (bookingId: string) => prisma.assignment.findMany({ where: { activeBookingId: bookingId } });

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
});
beforeEach(async () => {
  await prisma.notificationOutbox.deleteMany({}).catch(() => {});
  await prisma.driverSettlement.deleteMany({});
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
  await prisma.passengerRating.deleteMany({});
  await prisma.receiptEmail.deleteMany({});
  await prisma.booking.deleteMany({});
  for (const name of ['Andreas', 'Maria', 'Petros']) {
    const d = await prisma.driver.findFirst({ where: { publicName: name } });
    if (d) await prisma.driver.update({ where: { id: d.id }, data: { onDuty: false, available: false } });
  }
});

describe('§5 accept races', () => {
  it('two drivers accept the same booking at once → exactly one active assignment', async () => {
    const a = await driverAt('Andreas', 1);
    const m = await driverAt('Maria', 2);
    const b = await newBooking();
    await runOnce();
    const offer = (await getDriverActiveOffer(a.driverId)) ?? (await getDriverActiveOffer(m.driverId));
    expect(offer).not.toBeNull();
    const [r1, r2] = await Promise.all([acceptOffer(offer!.offerId, a.driverId), acceptOffer(offer!.offerId, m.driverId)]);
    expect([r1.ok, r2.ok].filter(Boolean).length).toBe(1); // the offer belongs to one driver only
    expect((await activeOf(b.id)).length).toBe(1);
  });
});

describe('§5 GPS loss rematch', () => {
  it('assigned with OLD GPS → not rematched on the next tick (window counts from assignment)', async () => {
    const a = await driverAt('Andreas', 1, 10 * 60_000); // last fix 10 min old
    const b = await enRoute(a);
    await runOnce();
    const now = await prisma.booking.findUnique({ where: { id: b.id } });
    expect(now!.status).toBe('EN_ROUTE');
    expect((await activeOf(b.id))[0]?.driverId).toBe(a.driverId);
  });

  it('a future-dated phone clock cannot stretch the window (server receive time counts)', async () => {
    const a = await driverAt('Andreas', 1);
    const b = await enRoute(a);
    const old = new Date(Date.now() - GPS_LOSS_MS - 5_000);
    await prisma.assignment.updateMany({ where: { activeBookingId: b.id }, data: { assignedAt: old } });
    await prisma.latestDriverLocation.update({ where: { driverId: a.driverId }, data: { receivedAt: old, sampledAt: new Date(Date.now() + 55_000) } });
    await runOnce();
    expect((await prisma.booking.findUnique({ where: { id: b.id } }))!.status).toBe('SEARCHING');
  });

  it('rematch vs driver «arrived» at the same time → one consistent outcome; old driver is told', async () => {
    const a = await driverAt('Andreas', 0.02);
    const b = await enRoute(a);
    const old = new Date(Date.now() - GPS_LOSS_MS - 5_000);
    await prisma.assignment.updateMany({ where: { activeBookingId: b.id }, data: { assignedAt: old } });
    await prisma.latestDriverLocation.update({ where: { driverId: a.driverId }, data: { receivedAt: old, sampledAt: old } });
    const [, arr] = await Promise.all([runOnce(), arriveAtPickup(b.id, a.driverId, b.rev)]);
    const after = await prisma.booking.findUnique({ where: { id: b.id } });
    const act = await activeOf(b.id);
    if (arr.ok) { expect(after!.status).toBe('ARRIVED'); expect(act[0]?.driverId).toBe(a.driverId); }
    else {
      expect(act.every((x) => x.driverId !== a.driverId)).toBe(true);
      const told = await prisma.notificationOutbox.count({ where: { audience: `DRIVER:${a.userId}`, title: 'Ride reassigned' } });
      expect(told).toBe(1);
    }
  });

  it('old driver comes back online after the rematch → cannot act, GPS does not revive the ride', async () => {
    const a = await driverAt('Andreas', 1);
    const b = await enRoute(a);
    const old = new Date(Date.now() - GPS_LOSS_MS - 5_000);
    await prisma.assignment.updateMany({ where: { activeBookingId: b.id }, data: { assignedAt: old } });
    await prisma.latestDriverLocation.update({ where: { driverId: a.driverId }, data: { receivedAt: old, sampledAt: old } });
    await runOnce();
    expect((await prisma.booking.findUnique({ where: { id: b.id } }))!.status).not.toBe('EN_ROUTE');
    // Back online: a fresh GPS sample, then the stale «arrived» with the old revision.
    await ingestLocation(a.driverId, { lat: marina.lat, lng: marina.lng, accuracyM: 8, sampledAt: new Date().toISOString(), gpsSession: `back-${RUN}`, sequence: 1 });
    const arr = await arriveAtPickup(b.id, a.driverId, b.rev);
    expect(arr.ok).toBe(false);
    expect((await activeOf(b.id)).some((x) => x.driverId === a.driverId)).toBe(false);
  });

  it('staff unassign vs driver «start» at the pickup → never both', async () => {
    const a = await driverAt('Andreas', 0.02);
    const b = await enRoute(a);
    const ar = await arriveAtPickup(b.id, a.driverId, b.rev); if (!ar.ok) throw new Error('arrive');
    const code = (await prisma.booking.findUnique({ where: { id: b.id } }))!.startCode!;
    const [un, st] = await Promise.all([
      unassignBooking({ bookingId: b.id, expectedRevision: ar.revision, actorId: 'admin', reason: 'test' }),
      startTrip(b.id, a.driverId, ar.revision, code),
    ]);
    expect([un.ok, st.ok].filter(Boolean).length).toBe(1);
    const after = await prisma.booking.findUnique({ where: { id: b.id } });
    if (st.ok) expect(after!.status).toBe('IN_PROGRESS');
    else expect((await activeOf(b.id)).length).toBe(0);
  });
});

describe('§5 repeated completion and amount entry', () => {
  it('two «complete» taps at once → one completion, one fare row', async () => {
    const a = await driverAt('Andreas', 0.02);
    const b = await inProgress(a);
    const [c1, c2] = await Promise.all([completeTrip(b.id, a.driverId, b.rev), completeTrip(b.id, a.driverId, b.rev)]);
    expect([c1.ok, c2.ok].filter(Boolean).length).toBe(1);
    expect(await prisma.fare.count({ where: { bookingId: b.id } })).toBe(1);
    expect(await prisma.bookingEvent.count({ where: { bookingId: b.id, afterStatus: 'COMPLETED' } })).toBe(1);
  });

  it('two first amount entries at once → one settlement; a correction needs the revision + reason', async () => {
    const a = await driverAt('Andreas', 0.02);
    const b = await inProgress(a);
    const c = await completeTrip(b.id, a.driverId, b.rev); if (!c.ok) throw new Error('complete');
    const [s1, s2] = await Promise.all([
      reportSettlement(a.driverId, b.id, { reportedFinalCents: 2500 }),
      reportSettlement(a.driverId, b.id, { reportedFinalCents: 2600 }),
    ]);
    expect([s1.ok, s2.ok].filter(Boolean).length).toBe(1);
    expect(await prisma.driverSettlement.count({ where: { bookingId: b.id } })).toBe(1);
    // A correction without the revision it corrects is refused…
    const noRev = await reportSettlement(a.driverId, b.id, { reportedFinalCents: 2700, correctionReason: 'meter re-read' });
    expect(noRev.ok).toBe(false);
    // …two parallel corrections of revision 1 → only one lands.
    const [k1, k2] = await Promise.all([
      reportSettlement(a.driverId, b.id, { reportedFinalCents: 2700, correctionReason: 'meter re-read', expectedRevision: 1 }),
      reportSettlement(a.driverId, b.id, { reportedFinalCents: 2800, correctionReason: 'meter re-read', expectedRevision: 1 }),
    ]);
    expect([k1.ok, k2.ok].filter(Boolean).length).toBe(1);
    expect(await prisma.driverSettlement.count({ where: { bookingId: b.id } })).toBe(2);
  });
});
