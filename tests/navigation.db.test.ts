import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

// /api/v1/driver/navigation against the _test DB: the target comes from the driver's own active
// assignment (pickup before boarding, destination once IN_PROGRESS), Google is called with the
// driver's language, and without a router we say "unavailable" instead of drawing a fake route.
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
import { acceptOffer, getDriverActiveOffer } from '@/server/dispatch/offers';
import type { CreateBookingInput } from '@/lib/validation';
import * as nav from '@/app/api/v1/driver/navigation/route';

const marina = { lat: 34.6706, lng: 33.0413, label: 'Limassol Marina' };
const lca = { lat: 34.8751, lng: 33.6249, label: 'Larnaca Airport (LCA)' };
const RUN = `${Date.now()}`;
let n = 0;

const post = (body: unknown) => nav.POST(new Request('http://localhost:3000/api/v1/driver/navigation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
async function asStaff(login: string) {
  jar.clear();
  const u = await prisma.staffUser.findUnique({ where: { login } });
  if (!u) throw new Error(`seed user ${login} missing`);
  await createStaffSession(u);
}

async function assignedTrip() {
  const d = (await prisma.driver.findFirst({ where: { publicName: 'Andreas' } }))!;
  await prisma.driver.update({ where: { id: d.id }, data: { onDuty: true, available: true, active: true } });
  const now = new Date();
  const loc = { lat: marina.lat + 0.009, lng: marina.lng, accuracyM: 10, sampledAt: now, receivedAt: now, gpsSession: `nav-${RUN}`, sequence: ++n };
  await prisma.latestDriverLocation.upsert({ where: { driverId: d.id }, update: loc, create: { driverId: d.id, ...loc } });
  const r = await createBooking({ pickup: marina, dropoff: lca, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'Nav', phone: '+35799123456' } as CreateBookingInput, `nav-${RUN}-${++n}`);
  if (!r.ok) throw new Error('create failed');
  await runOnce();
  const o = await getDriverActiveOffer(d.id);
  if (!o) throw new Error('no offer');
  expect((await acceptOffer(o.offerId, d.id)).ok).toBe(true);
  googleRoutes.mockClear(); // dispatch's own pickup-ETA lookups are not under test here
  return (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
}

const googleRoutes = vi.fn();
beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
});
beforeEach(async () => {
  for (const m of ['chatMessage', 'fare', 'waitingSession', 'driverOffer', 'dispatchJob', 'bookingEvent', 'preAssignment', 'assignment', 'trackingGrant', 'latestDriverLocation', 'idempotencyReceipt', 'rateLimitBucket', 'booking'] as const) {
    await (prisma[m] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({});
  }
  googleRoutes.mockReset();
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    googleRoutes(String(url), JSON.parse(String(init.body)), (init.headers as Record<string, string>)['X-Goog-FieldMask']);
    return new Response(JSON.stringify({ routes: [{
      distanceMeters: 2400, duration: '300s', polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
      legs: [{ steps: [
        { distanceMeters: 1000, startLocation: { latLng: { latitude: 38.5, longitude: -120.2 } }, navigationInstruction: { maneuver: 'DEPART', instructions: 'Κατευθυνθείτε βόρεια' } },
        { distanceMeters: 1400, startLocation: { latLng: { latitude: 40.7, longitude: -120.95 } }, navigationInstruction: { maneuver: 'TURN_LEFT', instructions: 'Στρίψτε αριστερά' } },
      ] }],
    }] }), { headers: { 'content-type': 'application/json' } });
  });
  process.env.GOOGLE_MAPS_SERVER_API_KEY = 'test-key';
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.GOOGLE_MAPS_SERVER_API_KEY; });

describe('driver navigation API', () => {
  it('rejects anonymous and non-driver sessions', async () => {
    jar.clear();
    expect((await post({ from: marina })).status).toBe(401);
    await asStaff('dispatcher');
    expect((await post({ from: marina })).status).toBe(403);
  });

  it('no active trip → NO_TRIP, Google not called', async () => {
    await asStaff('andreas');
    const j = await (await post({ from: marina, lang: 'en' })).json();
    expect(j).toMatchObject({ available: false, reason: 'NO_TRIP' });
    expect(googleRoutes).not.toHaveBeenCalled();
  });

  it('routes to the pickup, in the driver language, with anchored steps', async () => {
    const b = await assignedTrip();
    await asStaff('andreas');
    const res = await post({ from: { lat: 34.68, lng: 33.04 }, heading: 370, lang: 'el', to: lca /* ignored */ });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ available: true, leg: 'pickup', bookingId: b.id, distanceM: 2400, durationSec: 300 });
    expect(j.target).toEqual({ lat: marina.lat, lng: marina.lng });
    expect(j.path).toHaveLength(3);
    expect(j.steps.map((s: { at: number; maneuver: string }) => [s.at, s.maneuver])).toEqual([[0, 'DEPART'], [1, 'TURN_LEFT']]);
    const [url, body, mask] = googleRoutes.mock.calls[0];
    expect(url).toContain('computeRoutes');
    expect(body.languageCode).toBe('el');
    expect(body.destination.location.latLng).toEqual({ latitude: marina.lat, longitude: marina.lng });
    expect(body.origin.location.heading).toBe(10);
    expect(mask).toContain('routes.legs.steps.navigationInstruction');
  });

  it('routes to the destination once the passenger is on board; nothing while waiting at pickup', async () => {
    const b = await assignedTrip();
    await asStaff('andreas');
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'IN_PROGRESS' } });
    const j = await (await post({ from: marina, lang: 'ru' })).json();
    expect(j).toMatchObject({ available: true, leg: 'dropoff', target: { lat: lca.lat, lng: lca.lng } });
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'ARRIVED' } });
    googleRoutes.mockClear();
    expect(await (await post({ from: marina })).json()).toMatchObject({ available: false, reason: 'ARRIVED' });
    expect(googleRoutes).not.toHaveBeenCalled();
  });

  it('without a router → unavailable (no simulated route); bad input → 422', async () => {
    await assignedTrip();
    await asStaff('andreas');
    delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
    expect(await (await post({ from: marina })).json()).toMatchObject({ available: false, reason: 'NO_ROUTER' });
    expect((await post({ from: { lat: 'x' } })).status).toBe(422);
    expect(googleRoutes).not.toHaveBeenCalled();
  });
});
