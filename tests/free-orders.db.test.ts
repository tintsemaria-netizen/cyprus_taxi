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
import { listFreeOrders, claimFreeOrder, FREE_ORDER_WINDOW_MIN } from '@/server/dispatch/free-orders';
import * as freeRoute from '@/app/api/v1/driver/free-orders/route';
import * as claimRoute from '@/app/api/v1/driver/free-orders/[id]/claim/route';
import type { CreateBookingInput } from '@/lib/validation';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const RUN = `${Date.now()}`;
let n = 0;

type Name = 'Andreas' | 'Maria' | 'Petros';
async function onDuty(name: Name, onDuty = true) {
  const d = (await prisma.driver.findFirst({ where: { publicName: name } }))!;
  await prisma.assignment.updateMany({ where: { activeDriverId: d.id }, data: { endedAt: new Date(), activeBookingId: null, activeDriverId: null, activeVehicleId: null } });
  await prisma.driverOffer.updateMany({ where: { activeDriverId: d.id }, data: { status: 'CANCELED', activeBookingId: null, activeDriverId: null } });
  await prisma.preAssignment.updateMany({ where: { driverId: d.id, status: 'COMMITTED' }, data: { status: 'RELEASED' } });
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty, available: onDuty, active: true } });
  const now = new Date();
  const loc = { lat: marina.lat + 0.01, lng: marina.lng, accuracyM: 10, sampledAt: now, receivedAt: now, gpsSession: `f-${RUN}`, sequence: ++n };
  await prisma.latestDriverLocation.upsert({ where: { driverId: d.id }, update: loc, create: { driverId: d.id, ...loc } });
  return d.id;
}
async function noDriverBooking(over: Partial<CreateBookingInput> = {}, ageMin = 0) {
  const r = await createBooking({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 2, passengerName: 'Free', phone: '+35799123456', ...over } as CreateBookingInput, `free-${RUN}-${++n}`);
  if (!r.ok) throw new Error('create failed');
  const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
  await prisma.dispatchJob.deleteMany({ where: { bookingId: b.id } });
  // updatedAt is @updatedAt, so set the age with raw SQL after the status change.
  await prisma.booking.update({ where: { id: b.id }, data: { status: 'NO_DRIVER' } });
  if (ageMin) await prisma.$executeRaw`UPDATE "Booking" SET "updatedAt" = now() - (${ageMin} * interval '1 minute') WHERE id = ${b.id}`;
  return (await prisma.booking.findUnique({ where: { id: b.id } }))!;
}
async function as(login: string) { jar.clear(); await createStaffSession((await prisma.staffUser.findUnique({ where: { login } }))!); }

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
});
beforeEach(async () => { jar.clear(); for (const nm of ['Andreas', 'Maria', 'Petros'] as Name[]) await onDuty(nm, false); });

describe('free orders board', () => {
  it('lists only rides automatic dispatch gave up on (not SEARCHING), and only to drivers whose car fits', async () => {
    const maria = await onDuty('Maria'); // COMFORT, 4 seats
    const petros = await onDuty('Petros'); // XL, 6 seats
    const free = await noDriverBooking();
    const searching = await createBooking({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'S', phone: '+35799123457' } as CreateBookingInput, `free-${RUN}-${++n}`);
    const xl = await noDriverBooking({ vClass: 'XL', passengerCount: 5 });

    const forMaria = (await listFreeOrders(maria)).map((o) => o.bookingId);
    expect(forMaria).toContain(free.id);
    expect(forMaria).not.toContain(xl.id); // class mismatch
    if (searching.ok) expect(forMaria).not.toContain((await prisma.booking.findUnique({ where: { reference: searching.body.reference } }))!.id);
    const forPetros = (await listFreeOrders(petros)).map((o) => o.bookingId);
    expect(forPetros).toContain(xl.id);
    expect(forPetros).not.toContain(free.id);

    const o = (await listFreeOrders(maria)).find((x) => x.bookingId === free.id)!;
    expect(o.distanceM).toBeGreaterThan(0);
    expect(o).not.toHaveProperty('passengerName'); // no passenger identity before taking
    expect(o).not.toHaveProperty('phone');
  });

  it('taking a free order assigns the driver and puts them en route; it leaves the board', async () => {
    const maria = await onDuty('Maria');
    const b = await noDriverBooking();
    const r = await claimFreeOrder(b.id, maria);
    expect(r).toMatchObject({ ok: true, status: 'EN_ROUTE' });
    const after = (await prisma.booking.findUnique({ where: { id: b.id } }))!;
    expect(after.status).toBe('EN_ROUTE');
    expect(await prisma.assignment.findFirst({ where: { activeBookingId: b.id, activeDriverId: maria } })).not.toBeNull();
    const trail = await prisma.bookingEvent.findMany({ where: { bookingId: b.id }, orderBy: { createdAt: 'asc' }, select: { type: true } });
    expect(trail.map((e) => e.type)).toEqual(expect.arrayContaining(['FREE_ORDER_CLAIMED', 'STATUS_EN_ROUTE']));
    expect((await listFreeOrders(maria)).map((o) => o.bookingId)).not.toContain(b.id);
    // A second take by the same busy driver is refused.
    const b2 = await noDriverBooking();
    expect(await claimFreeOrder(b2.id, maria)).toMatchObject({ ok: false, code: 'DRIVER_BUSY' });
  });

  it('two drivers racing for one ride: exactly one wins', async () => {
    const maria = await onDuty('Maria');
    const andreas = await onDuty('Andreas');
    const b = await noDriverBooking();
    const [a, c] = await Promise.all([claimFreeOrder(b.id, maria), claimFreeOrder(b.id, andreas)]);
    expect([a.ok, c.ok].filter(Boolean)).toHaveLength(1);
    expect(await prisma.assignment.count({ where: { activeBookingId: b.id } })).toBe(1);
    const loser = a.ok ? c : a;
    expect(loser).toMatchObject({ ok: false, code: 'ORDER_GONE' });
  });

  it(`rides older than ${FREE_ORDER_WINDOW_MIN} min, retried or canceled rides are not listed or takeable; off-duty drivers can't take`, async () => {
    const maria = await onDuty('Maria');
    const old = await noDriverBooking({}, FREE_ORDER_WINDOW_MIN + 5);
    expect((await listFreeOrders(maria)).map((o) => o.bookingId)).not.toContain(old.id);
    expect(await claimFreeOrder(old.id, maria)).toMatchObject({ ok: false, code: 'ORDER_GONE' });

    const retried = await noDriverBooking();
    await prisma.booking.update({ where: { id: retried.id }, data: { status: 'SEARCHING' } });
    expect(await claimFreeOrder(retried.id, maria)).toMatchObject({ ok: false, code: 'ORDER_GONE' });

    await onDuty('Maria', false);
    const b = await noDriverBooking();
    expect(await claimFreeOrder(b.id, maria)).toMatchObject({ ok: false, code: 'DRIVER_INELIGIBLE' });
  });

  it('HTTP: driver-only; claim returns EN_ROUTE', async () => {
    expect((await freeRoute.GET()).status).toBe(401);
    await as('dispatcher');
    expect((await freeRoute.GET()).status).toBe(403);
    await onDuty('Maria');
    const b = await noDriverBooking();
    await as('maria');
    const list = await (await freeRoute.GET()).json();
    expect(list.orders.map((o: { bookingId: string }) => o.bookingId)).toContain(b.id);
    const res = await claimRoute.POST(new Request('http://x/api/v1/driver/free-orders/' + b.id + '/claim', { method: 'POST' }), { params: Promise.resolve({ id: b.id }) });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('EN_ROUTE');
  });
});
