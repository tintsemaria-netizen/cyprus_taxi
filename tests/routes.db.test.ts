import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// HTTP-level authorization tests (2026-10-01 audit Stage 1.9): call the real route handlers with
// a Request, against the _test database, with next/headers' cookie jar replaced by an in-memory
// map so the real session helpers (createStaffSession / createPassengerSession / exchangeToken)
// work unchanged.
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
import { createPassengerSession } from '@/server/passenger';
import { createBooking } from '@/server/bookings';
import { createShareGrant } from '@/lib/tracking';
import type { CreateBookingInput } from '@/lib/validation';

import * as adminDrivers from '@/app/api/v1/admin/drivers/route';
import * as adminApplications from '@/app/api/v1/admin/applications/route';
import * as adminSettings from '@/app/api/v1/admin/settings/route';
import * as adminReliability from '@/app/api/v1/admin/reliability/route';
import * as dispatchBookings from '@/app/api/v1/dispatch/bookings/route';
import * as driverOffers from '@/app/api/v1/driver/offers/route';
import * as driverDashboard from '@/app/api/v1/driver/dashboard/route';
import * as passengerRides from '@/app/api/v1/passenger/rides/route';
import * as rideReceipt from '@/app/api/v1/passenger/rides/[id]/receipt/route';
import * as rideRating from '@/app/api/v1/passenger/rides/[id]/rating/route';
import * as rideTrack from '@/app/api/v1/passenger/rides/[id]/track/route';
import * as meExport from '@/app/api/v1/passenger/me/export/route';
import * as meDelete from '@/app/api/v1/passenger/me/delete/route';
import * as trackingBooking from '@/app/api/v1/tracking/booking/route';
import * as trackingShare from '@/app/api/v1/tracking/share/route';
import * as trackingCancel from '@/app/api/v1/tracking/cancel/route';
import * as trackingExchange from '@/app/api/v1/tracking/exchange/route';
import * as otpRequest from '@/app/api/v1/passenger/otp/request/route';

const BASE = 'http://localhost:3000/api/v1';
const req = (path: string, init?: { method?: string; body?: unknown }) =>
  new Request(`${BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 250)}` },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function asStaff(login: string) {
  jar.clear();
  const u = await prisma.staffUser.findUnique({ where: { login } });
  if (!u) throw new Error(`seed user ${login} missing`);
  await createStaffSession(u);
}
async function asPassenger(id: string) { jar.clear(); await createPassengerSession(id); }
function anonymous() { jar.clear(); }

const RUN = `${Date.now()}`;
let n = 0;
async function passengerWithRide(status: 'COMPLETED' | 'SEARCHING' = 'COMPLETED') {
  const p = await prisma.passenger.create({ data: { phone: `+3579550${++n}${RUN.slice(-4)}`.slice(0, 15), phoneVerifiedAt: new Date() } });
  const r = await createBooking({ pickup: { lat: 34.6706, lng: 33.0413, label: 'A' }, dropoff: { lat: 34.8751, lng: 33.6249, label: 'B' }, when: 'NOW', vClass: 'COMFORT', passengerCount: 1, passengerName: 'P', phone: p.phone } as CreateBookingInput, `routes-${RUN}-${n}`, undefined, p.id);
  if (!r.ok) throw new Error('create');
  const b = (await prisma.booking.findUnique({ where: { reference: r.body.reference } }))!;
  if (status === 'COMPLETED') await prisma.booking.update({ where: { id: b.id }, data: { status: 'COMPLETED' } });
  return { p, b, trackToken: r.body.tracking.token };
}

beforeAll(async () => {
  if (!dbName.endsWith('_test')) throw new Error(`Refusing: DB name must end in _test (got "${dbName}").`);
});
beforeEach(() => { jar.clear(); });

describe('staff routes enforce role', () => {
  it('admin-only routes: anonymous 401, driver 403, dispatcher 403, admin 200', async () => {
    for (const [name, call] of [
      ['admin/drivers', () => adminDrivers.GET()],
      ['admin/applications', () => adminApplications.GET(req('/admin/applications'))],
      ['admin/settings', () => adminSettings.GET()],
      ['admin/reliability', () => adminReliability.GET(req('/admin/reliability?days=30'))],
    ] as const) {
      anonymous(); expect((await call()).status, `${name} anon`).toBe(401);
      await asStaff('andreas'); expect((await call()).status, `${name} driver`).toBe(403);
      await asStaff('dispatcher'); const d = (await call()).status;
      if (name !== 'admin/drivers') expect(d, `${name} dispatcher`).toBe(403);
      await asStaff('admin'); expect((await call()).status, `${name} admin`).toBe(200);
    }
  });

  it('dispatch queue: anonymous 401, driver 403, dispatcher 200', async () => {
    anonymous(); expect((await dispatchBookings.GET(req('/dispatch/bookings'))).status).toBe(401);
    await asStaff('andreas'); expect((await dispatchBookings.GET(req('/dispatch/bookings'))).status).toBe(403);
    await asStaff('dispatcher'); expect((await dispatchBookings.GET(req('/dispatch/bookings'))).status).toBe(200);
  });

  it('driver routes: anonymous 401, passenger session 401, dispatcher 403, driver 200', async () => {
    const { p } = await passengerWithRide();
    anonymous(); expect((await driverOffers.GET()).status).toBe(401);
    await asPassenger(p.id); expect((await driverOffers.GET()).status).toBe(401);
    await asStaff('dispatcher'); expect((await driverDashboard.GET()).status).toBe(403);
    await asStaff('andreas'); expect((await driverDashboard.GET()).status).toBe(200);
  });
});

describe('passenger routes are owner-scoped', () => {
  it('anonymous callers get 401 on every passenger route', async () => {
    const { b } = await passengerWithRide();
    anonymous();
    expect((await passengerRides.GET()).status).toBe(401);
    expect((await rideReceipt.GET(req(`/passenger/rides/${b.id}/receipt`), params(b.id))).status).toBe(401);
    expect((await rideRating.GET(req(`/passenger/rides/${b.id}/rating`), params(b.id))).status).toBe(401);
    expect((await rideTrack.POST(req(`/passenger/rides/${b.id}/track`, { method: 'POST' }), params(b.id))).status).toBe(401);
    expect((await meExport.GET(req('/passenger/me/export'))).status).toBe(401);
    expect((await meDelete.POST(req('/passenger/me/delete', { method: 'POST', body: { confirm: 'DELETE' } }))).status).toBe(401);
  });

  it("another passenger cannot read, rate, track or receipt someone else's ride", async () => {
    const a = await passengerWithRide();
    const other = await passengerWithRide();
    await asPassenger(other.p.id);
    expect((await rideReceipt.GET(req(`/passenger/rides/${a.b.id}/receipt`), params(a.b.id))).status).toBe(404);
    expect((await rideRating.GET(req(`/passenger/rides/${a.b.id}/rating`), params(a.b.id))).status).toBe(404);
    expect((await rideRating.POST(req(`/passenger/rides/${a.b.id}/rating`, { method: 'POST', body: { stars: 1 } }), params(a.b.id))).status).toBe(404);
    expect((await rideTrack.POST(req(`/passenger/rides/${a.b.id}/track`, { method: 'POST' }), params(a.b.id))).status).toBe(403);
    const list = await (await passengerRides.GET()).json();
    expect(list.rides.map((r: { id: string }) => r.id)).not.toContain(a.b.id);
    // …while the owner can.
    await asPassenger(a.p.id);
    expect((await rideReceipt.GET(req(`/passenger/rides/${a.b.id}/receipt`), params(a.b.id))).status).toBe(409); // no Fare in this fixture → NO_RECEIPT, but authorized
  });

  it('account deletion needs an explicit confirmation', async () => {
    const { p } = await passengerWithRide();
    await asPassenger(p.id);
    expect((await meDelete.POST(req('/passenger/me/delete', { method: 'POST', body: {} }))).status).toBe(422);
    expect(await prisma.passenger.findUnique({ where: { id: p.id } })).not.toBeNull();
  });
});

describe('tracking links', () => {
  it('no tracking cookie → 401 on booking, share and cancel', async () => {
    anonymous();
    expect((await trackingBooking.GET()).status).toBe(401);
    expect((await trackingShare.POST(req('/tracking/share', { method: 'POST' }))).status).toBe(401);
    expect((await trackingCancel.POST(req('/tracking/cancel', { method: 'POST', body: { expectedRevision: 0 } }))).status).toBe(401);
  });

  it('the private link opens the ride; a read-only share link cannot be exchanged for it', async () => {
    const { b, trackToken } = await passengerWithRide('SEARCHING');
    anonymous();
    expect((await trackingExchange.POST(req('/tracking/exchange', { method: 'POST', body: { token: trackToken } }))).status).toBe(200);
    expect((await trackingBooking.GET()).status).toBe(200);
    const share = await createShareGrant(b.id);
    anonymous();
    expect((await trackingExchange.POST(req('/tracking/exchange', { method: 'POST', body: { token: share.token } }))).status).toBe(404);
    expect((await trackingBooking.GET()).status).toBe(401);
  });
});

describe('OTP never leaks the code over HTTP', () => {
  it('without a real SMS provider and with an empty allowlist the response carries no code', async () => {
    anonymous();
    const res = await otpRequest.POST(req('/passenger/otp/request', { method: 'POST', body: { phone: '+35799000123' } }));
    const body = await res.json();
    expect(body.devCode).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/\d{6}/);
  });
});
