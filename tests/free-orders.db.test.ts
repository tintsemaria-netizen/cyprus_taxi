import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// Free orders board (2026-11-12): a ride is listed only after automatic dispatch gave up (NO_DRIVER),
// for drivers whose car fits; taking it is race-safe and puts the driver en route.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
    delete: (n: string) => { jar.delete(n); },
  }),
  headers: async () => new Headers(),
}));

const dbUrl = process.env.DATABASE_URL || '';
const dbName = (() => { try { return new URL(dbUrl).pathname.replace(/^\//, '').split('?')[0]; } catch { return ''; } })();

import { prisma } from '@/lib/db';
import { createStaffSession } from '@/lib/auth';
import { createBooking } from '@/server/bookings';
import { runOnce } from '@/server/dispatch/worker';
import { getDriverActiveOffer, rejectOffer } from '@/server/dispatch/offers';
import { listFreeOrders, claimFreeOrder, getFreeOrderDetail, FREE_BOARD_SEC, vehicleFits } from '@/server/dispatch/free-orders';
import * as detailRoute from '@/app/api/v1/driver/free-orders/[id]/route';
import * as freeRoute from '@/app/api/v1/driver/free-orders/route';
import * as claimRoute from '@/app/api/v1/driver/free-orders/[id]/claim/route';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const RUN = `${Date.now()}`;
let n = 0;

type Name = 'Andreas' | 'Maria' | 'Petros';
const ALL: Name[] = ['Andreas', 'Maria', 'Petros'];
async function setDuty(name: Name, on: boolean) {
  const d = (await prisma.driver.findFirst({ where: { publicName: name } }))!;
  await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  await prisma.driverOffer.updateMany({ where: { activeDriverId: d.id }, data: { status: 'CANCELED', activeBookingId: null, activeDriverId: null } });
  await prisma.preAssignment.updateMany({ where: { driverId: d.id, status: 'COMMITTED' }, data: { status: 'RELEASED' } });
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: on, available: on, active: true } });
  const now = new Date();
  const loc = { lat: marina.lat + 0.01, lng: marina.lng, accuracyM: 10, sampledAt: now, receivedAt: now, gpsSession: `f-${RUN}`, sequence: ++n };
  await prisma.latestDriverLocation.upsert({ where: { driverId: d.id }, update: loc, create: { driverId: d.id, ...loc } });
  return d.id;
}
async function searching(over: Partial<CreateBookingInput> = {}) {
  const r = await createBooking({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Eleni', phone: '+35799123456', ...over } as CreateBookingInput, `free-${RUN}-${++n}`);
  if (!r.ok) throw new Error('create failed');
  return (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
}
/** A searching ride that automatic dispatch has already exhausted (nobody on duty → opened). */
async function openRide(over: Partial<CreateBookingInput> = {}) {
  for (const nm of ALL) await setDuty(nm, false);
  const b = await searching(over);
  await runOnce();
  const job = await prisma.dispatchJob.findUnique({ where: { bookingId: b.id } });
  if (!job?.openedAt) throw new Error('ride was not opened to the board');
  return b;
}
async function as(login: string) { jar.clear(); await createStaffSession((await prisma.staffUser.findUnique({ where: { login } }))!); }

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
});
beforeEach(async () => {
  jar.clear();
  // Keep other suites' (or earlier runs') searches from interfering with runOnce here: the worker
  // would re-create jobs for leftover SEARCHING rides and offer them to our drivers first.
  await prisma.dispatchJob.deleteMany({});
  await prisma.booking.updateMany({ where: { status: { in: ['SEARCHING', 'REQUESTED'] } }, data: { status: 'CANCELED' } });
  for (const nm of ALL) await setDuty(nm, false);
});

describe('free orders board', () => {
  it('class rule: COMFORT rides fit COMFORT and XL cars, XL rides only XL; seats count', () => {
    expect(vehicleFits({ vClass: 'COMFORT', seats: 4 }, { vClass: 'COMFORT', passengerCount: 2 })).toBe(true);
    expect(vehicleFits({ vClass: 'XL', seats: 6 }, { vClass: 'COMFORT', passengerCount: 2 })).toBe(true);
    expect(vehicleFits({ vClass: 'COMFORT', seats: 4 }, { vClass: 'XL', passengerCount: 2 })).toBe(false);
    expect(vehicleFits({ vClass: 'XL', seats: 6 }, { vClass: 'XL', passengerCount: 5 })).toBe(true);
    expect(vehicleFits({ vClass: 'COMFORT', seats: 4 }, { vClass: 'COMFORT', passengerCount: 5 })).toBe(false);
  });

  it('a ride is NOT on the board while it is being offered to a nearby driver; it opens once nobody is left', async () => {
    const maria = await setDuty('Maria', true);
    const b = await searching();
    await runOnce();
    const offer = await getDriverActiveOffer(maria);
    expect(offer).not.toBeNull();
    expect((await listFreeOrders(maria)).map((o) => o.bookingId)).not.toContain(b.id);
    // Maria declines; nobody else eligible → the ride opens (still SEARCHING for the passenger).
    await rejectOffer(offer!.offerId, maria);
    await runOnce();
    const job = (await prisma.dispatchJob.findUnique({ where: { bookingId: b.id } }))!;
    expect(job.openedAt).not.toBeNull();
    expect(job.deadlineAt.getTime() - job.openedAt!.getTime()).toBe(FREE_BOARD_SEC * 1000);
    expect((await prisma.booking.findUnique({ where: { id: b.id } }))!.status).toBe('SEARCHING');
    // No more automatic offers once open.
    await runOnce();
    expect(await prisma.driverOffer.count({ where: { bookingId: b.id, status: 'OFFERED' } })).toBe(0);
  });

  it('with nobody on duty the ride opens at once; COMFORT ride visible to COMFORT and XL; name yes, phone no', async () => {
    const b = await openRide();
    const maria = await setDuty('Maria', true);
    const petros = await setDuty('Petros', true);
    const forMaria = await listFreeOrders(maria);
    const o = forMaria.find((x) => x.bookingId === b.id)!;
    expect(o).toBeDefined();
    expect(o.passengerName).toBe('Eleni');
    expect(o).not.toHaveProperty('phone');
    expect(o.expiresInMs).toBeGreaterThan(100_000);
    expect((await listFreeOrders(petros)).map((x) => x.bookingId)).toContain(b.id);
  });

  it('XL ride is visible to XL cars only', async () => {
    const b = await openRide({ vClass: 'XL', passengerCount: 5 });
    const maria = await setDuty('Maria', true);
    const petros = await setDuty('Petros', true);
    expect((await listFreeOrders(maria)).map((x) => x.bookingId)).not.toContain(b.id);
    expect((await listFreeOrders(petros)).map((x) => x.bookingId)).toContain(b.id);
    expect(await claimFreeOrder(b.id, maria)).toMatchObject({ ok: false, code: 'VEHICLE_INELIGIBLE' });
  });

  it('an XL car can take a COMFORT ride; taking puts the driver en route and clears the board', async () => {
    const b = await openRide();
    const petros = await setDuty('Petros', true);
    expect(await claimFreeOrder(b.id, petros)).toMatchObject({ ok: true, status: 'EN_ROUTE' });
    expect(await prisma.dispatchJob.findUnique({ where: { bookingId: b.id } })).toBeNull();
    expect(await prisma.assignment.findFirst({ where: { activeBookingId: b.id, activeDriverId: petros } })).not.toBeNull();
    const types = (await prisma.bookingEvent.findMany({ where: { bookingId: b.id }, select: { type: true } })).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['OPENED_TO_FREE_BOARD', 'FREE_ORDER_CLAIMED', 'STATUS_EN_ROUTE']));
    expect((await listFreeOrders(petros)).map((x) => x.bookingId)).not.toContain(b.id);
  });

  it('two drivers racing for one ride: exactly one wins', async () => {
    const b = await openRide();
    const maria = await setDuty('Maria', true);
    const andreas = await setDuty('Andreas', true);
    const [a, c] = await Promise.all([claimFreeOrder(b.id, maria), claimFreeOrder(b.id, andreas)]);
    expect([a.ok, c.ok].filter(Boolean)).toHaveLength(1);
    expect(await prisma.assignment.count({ where: { activeBookingId: b.id } })).toBe(1);
    expect(a.ok ? c : a).toMatchObject({ ok: false, code: 'ORDER_GONE' });
  });

  it('after the board window the ride becomes NO_DRIVER (passenger re-orders) and can no longer be taken', async () => {
    const b = await openRide();
    await prisma.dispatchJob.update({ where: { bookingId: b.id }, data: { deadlineAt: new Date(Date.now() - 1000) } });
    await runOnce();
    expect((await prisma.booking.findUnique({ where: { id: b.id } }))!.status).toBe('NO_DRIVER');
    const maria = await setDuty('Maria', true);
    expect((await listFreeOrders(maria)).map((x) => x.bookingId)).not.toContain(b.id);
    expect(await claimFreeOrder(b.id, maria)).toMatchObject({ ok: false, code: 'ORDER_GONE' });
  });

  it('off-duty drivers cannot take; a scheduled ride searched ahead of time is not opened early', async () => {
    const b = await openRide();
    const maria = await setDuty('Maria', false);
    expect(await claimFreeOrder(b.id, maria)).toMatchObject({ ok: false, code: 'DRIVER_INELIGIBLE' });

    const s = await searching();
    const at = new Date(Date.now() + 40 * 60_000);
    await prisma.booking.update({ where: { id: s.id }, data: { scheduledAt: at } });
    await prisma.dispatchJob.update({ where: { bookingId: s.id }, data: { deadlineAt: at } });
    await runOnce();
    expect((await prisma.dispatchJob.findUnique({ where: { bookingId: s.id } }))?.openedAt ?? null).toBeNull();
  });

  it('details for review: only while on the board and fitting the car; breakdown + time/km, no phone', async () => {
    const b = await openRide({ luggageCount: 3 });
    expect((await prisma.booking.findUnique({ where: { id: b.id } }))!.luggageCount).toBe(3); // bags stored on the ride
    await prisma.booking.update({ where: { id: b.id }, data: { fareCents: 7002, priceType: 'REGULATED_METER_ESTIMATE', fareBreakdown: JSON.stringify([{ label: 'Initial hire', cents: 380 }, { label: 'Distance', cents: 6622 }]) } });
    const maria = await setDuty('Maria', true);
    const d = await getFreeOrderDetail(b.id, maria);
    expect(d).not.toBeNull();
    expect(d!.passengerName).toBe('Eleni');
    expect(d!.luggageCount).toBe(3); // and shown to the driver
    expect(d!.fareBreakdown).toHaveLength(2);
    expect(d!.pickupDistanceM).toBeGreaterThan(0);
    expect(d!.pickupEtaSec).toBeGreaterThan(0);
    expect(d).not.toHaveProperty('phone');
    // XL ride is not reviewable by a COMFORT car; a taken ride is gone.
    const xl = await openRide({ vClass: 'XL', passengerCount: 5 });
    const maria2 = await setDuty('Maria', true);
    expect(await getFreeOrderDetail(xl.id, maria2)).toBeNull();
    const petros = await setDuty('Petros', true);
    expect((await claimFreeOrder(xl.id, petros)).ok).toBe(true);
    expect(await getFreeOrderDetail(xl.id, petros)).toBeNull();
    // HTTP 404 for a gone ride
    await as('petros');
    const res = await detailRoute.GET(new Request('http://x'), { params: Promise.resolve({ id: xl.id }) });
    expect(res.status).toBe(404);
  });

  it('HTTP: driver-only; claim returns EN_ROUTE', async () => {
    expect((await freeRoute.GET()).status).toBe(401);
    await as('dispatcher');
    expect((await freeRoute.GET()).status).toBe(403);
    const b = await openRide();
    await setDuty('Maria', true);
    await as('maria');
    const list = await (await freeRoute.GET()).json();
    expect(list.orders.map((o: { bookingId: string }) => o.bookingId)).toContain(b.id);
    const res = await claimRoute.POST(new Request('http://x/api/v1/driver/free-orders/' + b.id + '/claim', { method: 'POST' }), { params: Promise.resolve({ id: b.id }) });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('EN_ROUTE');
  });
});
